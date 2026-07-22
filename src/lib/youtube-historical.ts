import { youtubeAccessToken, youtubeGet, youtubeConfigured } from './plugins/youtube/client'
import { logPipelineIssue } from './pipeline-issues'
import { storage } from './storage'
import { classifyYoutubeSuccess } from './youtube-metrics'

// ── YouTube channel history import ──────────────────────────────────────────────
//
// The Meta counterpart (meta-historical.ts) imports PAID ad performance (spend/CPL).
// There is no equivalent for YouTube - these are organic uploads with no ad account,
// so this imports the channel's video history as organic engagement rows in the same
// `HistoricalAd` table (platform: 'youtube'), with views/likesCount/commentsCount
// instead of spend/cpl, and isSuccessful left null (there's no cost-based bar to
// clear on an organic video). See prisma/schema.prisma HistoricalAd for the shape.
//
// Unlike Meta, the Data API returns each video's thumbnail URL directly in the same
// videos.list call used for statistics, so no separate "fetch the creative" pass is
// needed - the thumbnail is downloaded inline during history import.

interface PlaylistItem {
  contentDetails?: { videoId?: string }
}

interface VideoRow {
  id?: string
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } }
  }
  statistics?: {
    viewCount?: string
    likeCount?: string
    commentCount?: string
  }
}

// Lazy import to match meta-historical.ts's pattern (avoids a circular dep at module
// load time and keeps this file usable before `prisma generate` has run).
async function getPrisma() {
  const { prisma } = await import('./db')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma as any
}

async function uploadsPlaylistId(token: string): Promise<string> {
  const data = await youtubeGet<{ items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>(
    'channels',
    { part: 'contentDetails', mine: 'true' },
    token,
  )
  const id = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!id) throw new Error('Could not resolve the channel\'s uploads playlist - is the connected account the channel owner?')
  return id
}

// Page through the uploads playlist to collect every video id (channel history, not
// just posts made through this pipeline).
async function listAllVideoIds(token: string, playlistId: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    const data = await youtubeGet<{ items?: PlaylistItem[]; nextPageToken?: string }>(
      'playlistItems',
      { part: 'contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) },
      token,
    )
    for (const item of data.items ?? []) {
      const id = item.contentDetails?.videoId
      if (id) ids.push(id)
    }
    pageToken = data.nextPageToken
    pages++
  } while (pageToken && pages < 40) // 40 * 50 = 2000 videos, ample headroom
  return ids
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export interface YouTubeImportResult {
  total: number
  imported: number
  thumbnailsDownloaded: number
  errors: number
}

export async function importYouTubeHistory(): Promise<YouTubeImportResult> {
  if (!youtubeConfigured()) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN must be set in .env.local')
  }

  const token = await youtubeAccessToken()
  const playlistId = await uploadsPlaylistId(token)
  const videoIds = await listAllVideoIds(token, playlistId)

  const db = await getPrisma()
  let imported = 0, thumbnailsDownloaded = 0, errors = 0

  for (const group of chunk(videoIds, 50)) {
    try {
      const data = await youtubeGet<{ items?: VideoRow[] }>(
        'videos',
        { part: 'snippet,statistics', id: group.join(','), maxResults: '50' },
        token,
      )

      for (const video of data.items ?? []) {
        const id = video.id
        if (!id) continue
        try {
          const snippet = video.snippet ?? {}
          const stats = video.statistics ?? {}
          const thumbUrl = snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url

          const existing = await db.historicalAd.findUnique({
            where: { metaAdId: id },
            select: { creativeImagePath: true },
          })

          let creativeImagePath = existing?.creativeImagePath ?? null
          if (thumbUrl && !creativeImagePath) {
            try {
              const res = await fetch(thumbUrl)
              if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer())
                const path = `historical-ads/youtube-${id}.jpg`
                await storage.save(path, buf)
                creativeImagePath = path
                thumbnailsDownloaded++
              }
            } catch {
              // Thumbnail download is best-effort - the row still gets imported without it.
            }
          }

          const views = parseInt(stats.viewCount ?? '0') || 0
          const likesCount = parseInt(stats.likeCount ?? '0') || 0
          const commentsCount = parseInt(stats.commentCount ?? '0') || 0
          // Engagement-rate based - see youtube-metrics.ts for why CPL can't apply here.
          const isSuccessful = classifyYoutubeSuccess(views, likesCount, commentsCount)

          await db.historicalAd.upsert({
            where: { metaAdId: id },
            create: {
              metaAdId: id,
              platform: 'youtube',
              adName: snippet.title ?? id,
              bodyText: snippet.description ?? '',
              headlineText: snippet.title ?? null,
              leads: 0,
              views,
              likesCount,
              commentsCount,
              isSuccessful,
              dateFrom: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
              dateTo: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
              source: 'import',
              creativeType: 'video',
              creativeSourceUrl: thumbUrl,
              creativeImagePath,
              externalWatchUrl: `https://www.youtube.com/watch?v=${id}`,
            },
            update: {
              adName: snippet.title ?? id,
              bodyText: snippet.description ?? '',
              headlineText: snippet.title ?? null,
              views,
              likesCount,
              commentsCount,
              isSuccessful,
              ...(creativeImagePath ? { creativeImagePath, creativeSourceUrl: thumbUrl } : {}),
            },
          })
          imported++
        } catch {
          errors++
        }
      }
    } catch {
      errors += group.length
    }
  }

  if (errors > 0) {
    await logPipelineIssue({
      severity: errors > 5 ? 'critical' : 'warning',
      stage: 'analytics',
      description: `YouTube historical import completed with ${errors} errors out of ${videoIds.length} videos. ${imported} records upserted.`,
    })
  }

  return { total: videoIds.length, imported, thumbnailsDownloaded, errors }
}
