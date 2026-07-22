import { importHistoricalCreativeImages } from '@/lib/meta-historical'
import { importYouTubeHistory } from '@/lib/youtube-historical'
import { youtubeConfigured } from '@/lib/plugins/youtube/client'

// Pulls the actual creative media for each imported ad/video and stores it - the
// real image or video file for Meta (POST { force: true } to re-download ones that
// already exist), and the thumbnail for YouTube (the Data API has no video-file
// download endpoint; the Publish page links out to the real video instead via
// externalWatchUrl). YouTube thumbnails are fetched as part of the history import
// itself, so this just re-runs that pass to backfill any that failed the first time.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const force = Boolean(body?.force)

  const result: {
    meta?: Awaited<ReturnType<typeof importHistoricalCreativeImages>>
    metaError?: string
    youtube?: Awaited<ReturnType<typeof importYouTubeHistory>>
    youtubeError?: string
  } = {}

  if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
    try {
      result.meta = await importHistoricalCreativeImages({ force })
    } catch (err) {
      result.metaError = String(err)
    }
  } else {
    result.metaError = 'META_ACCESS_TOKEN / META_AD_ACCOUNT_ID not set - skipped'
  }

  if (youtubeConfigured()) {
    try {
      result.youtube = await importYouTubeHistory()
    } catch (err) {
      result.youtubeError = String(err)
    }
  } else {
    result.youtubeError = 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN not set - skipped'
  }

  if (!result.meta && !result.youtube) {
    return Response.json({ error: 'Creative import failed on both platforms', ...result }, { status: 500 })
  }
  return Response.json(result)
}
