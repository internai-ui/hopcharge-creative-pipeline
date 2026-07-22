import type { PublisherPlugin } from '../interfaces'
import type { Creative } from '@prisma/client'
import { storage } from '@/lib/storage'
import { DATA_API, youtubeAccessToken } from './client'

// ── YouTube publisher (YouTube Data API v3 - organic Shorts / videos) ─────────
//
// Generated creatives are published to the connected channel as regular YouTube
// videos - a 9:16 clip lands as a Short - NOT as paid Google Ads. There is no ad
// account, no Demand Gen ad, no budget, and no ad scheduling: the video simply goes
// up on the channel. The whole flow is one Data API call chain:
//
//   1. OAuth2: exchange the stored refresh token for an access token.
//   2. videos.insert (resumable upload): initiate the session with the snippet +
//      status metadata, then PUT the video bytes. YouTube returns the new video id.
//
// "Draft" maps to privacyStatus = private (only the channel owner can see it -
// nothing is public until it is flipped), "production" maps to public. pause()
// flips a live video back to private. There is no budget, so scale() is a no-op.
// YouTube hosts video only, so image creatives are rejected.
//
// Requires (see .env.example): GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (a Google
// OAuth client with the YouTube Data API v3 enabled) and YOUTUBE_REFRESH_TOKEN
// (minted for the channel owner with the youtube.upload + youtube scopes, or the
// single youtube.force-ssl scope).

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'

type Copy = {
  caption?: string
  headline?: string
  ytHeadlines?: string[]
  ytDescriptions?: string[]
  ytCallToAction?: string
}

export class YouTubePublisher implements PublisherPlugin {
  name = 'youtube'
  platform = 'youtube' as const

  private finalUrl = process.env.YOUTUBE_FINAL_URL ?? process.env.META_WEBSITE_URL ?? 'https://hopcharge.com'
  // Video category id. 2 = Autos & Vehicles (topical for EV charging); 22 = People
  // & Blogs is the safe universal fallback. Region-specific - override if needed.
  private categoryId = process.env.YOUTUBE_CATEGORY_ID ?? '2'
  private draftMode = (process.env.YOUTUBE_DRAFT_MODE ?? 'true') !== 'false'

  async publish({
    creative,
    caption,
    headline,
    ytHeadlines,
    ytDescriptions,
    ytCallToAction,
    draft,
  }: {
    creative: Creative
    caption?: string
    headline?: string
    // funnelStage / scheduledAt / adSchedule are accepted for PublisherPlugin parity
    // but intentionally unused: an organic YouTube video has no ad group, no start
    // time and no day-parting. Publishing is immediate (private or public).
    funnelStage?: 'TOF' | 'MOF' | 'BOF' | null
    ytHeadlines?: string[]
    ytDescriptions?: string[]
    ytCallToAction?: string
    draft?: boolean
  }): Promise<{ externalPostId: string; isDraft: boolean }> {
    if (creative.mediaType !== 'video') {
      throw new Error('YouTube publishing supports video creatives only (images cannot be posted to YouTube)')
    }
    const filePath = creative.editedFilePath ?? creative.originalFilePath
    if (!filePath) throw new Error('Creative has no file path')

    const isDraft = draft ?? this.draftMode
    const token = await youtubeAccessToken()
    const bytes = await storage.read(filePath)

    const { title, description, tags } = this.buildMetadata({ caption, headline, ytHeadlines, ytDescriptions, ytCallToAction })
    const videoId = await this.uploadVideo(token, bytes, {
      title,
      description,
      tags,
      privacyStatus: isDraft ? 'private' : 'public',
    })
    return { externalPostId: videoId, isDraft }
  }

  // ── Video snippet from the idea copy ────────────────────────────────────────
  // A plain video has one title + one description (no responsive rotation), so the
  // YouTube copy fields are folded into those: title = the punchiest headline,
  // description = primary text + the extra descriptions + a CTA line + hashtags.
  private buildMetadata(copy: Copy): { title: string; description: string; tags: string[] } {
    const titleSrc = copy.ytHeadlines?.find(Boolean) ?? copy.headline ?? copy.caption ?? 'Hopcharge'
    // YouTube rejects < and > in titles; cap at 100 chars.
    const title = titleSrc.replace(/[<>]/g, '').trim().slice(0, 100) || 'Hopcharge'

    const lines: string[] = []
    if (copy.caption) lines.push(copy.caption.trim())
    const extraDescs = (copy.ytDescriptions ?? []).filter(Boolean)
    if (extraDescs.length) lines.push(extraDescs.join(' '))
    const cta = copy.ytCallToAction ? copy.ytCallToAction.replace(/_/g, ' ').toLowerCase() : 'learn more'
    lines.push(`${cta.charAt(0).toUpperCase()}${cta.slice(1)}: ${this.finalUrl}`)
    lines.push('#Shorts #EV #Hopcharge #EVcharging')
    // Data API caps descriptions at 5000 chars and disallows < and >.
    const description = lines.join('\n\n').replace(/[<>]/g, '').slice(0, 4900)

    const tags = ['Hopcharge', 'EV charging', 'electric vehicle', 'on-demand charging', 'EV']
    return { title, description, tags }
  }

  // ── videos.insert via resumable upload (single-PUT finalize) ────────────────
  // Short-form videos are small, so the whole file goes in one PUT. The response
  // carries the created video resource (its id is assigned immediately; YouTube
  // keeps processing the media server-side afterwards).
  private async uploadVideo(
    token: string,
    bytes: Buffer,
    meta: { title: string; description: string; tags: string[]; privacyStatus: 'private' | 'public' | 'unlisted' },
  ): Promise<string> {
    const metadata = {
      snippet: {
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        categoryId: this.categoryId,
      },
      status: {
        privacyStatus: meta.privacyStatus,
        selfDeclaredMadeForKids: false,
        embeddable: true,
      },
    }

    // 1. Initiate a resumable upload session; the session URL comes back in Location.
    const init = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(bytes.length),
        'X-Upload-Content-Type': 'video/*',
      },
      body: JSON.stringify(metadata),
    })
    if (!init.ok) throw new Error(`YouTube upload init failed: ${init.status} ${await init.text()}`)
    const sessionUrl = init.headers.get('location')
    if (!sessionUrl) throw new Error('YouTube upload init returned no resumable session URL')

    // 2. Upload the bytes in one PUT. The finalized response is the video resource.
    const put = await fetch(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/*', 'Content-Length': String(bytes.length) },
      body: new Uint8Array(bytes),
    })
    const data = await put.json().catch(() => ({}))
    if (!put.ok || !data?.id) {
      throw new Error(`YouTube video upload failed: ${put.status} ${JSON.stringify(data).slice(0, 300)}`)
    }
    return data.id as string
  }

  // ── Pause = unpublish (flip the video back to private) ──────────────────────
  // videos.update overwrites the whole status part, so read the current status
  // first and only change privacyStatus - this preserves madeForKids / publishAt.
  async pause(externalPostId: string): Promise<void> {
    const token = await youtubeAccessToken()
    const current = await fetch(`${DATA_API}/videos?part=status&id=${externalPostId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const currentData = await current.json()
    const status = { ...(currentData?.items?.[0]?.status ?? {}), privacyStatus: 'private' }

    const res = await fetch(`${DATA_API}/videos?part=status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: externalPostId, status }),
    })
    if (!res.ok) throw new Error(`YouTube pause (set private) failed: ${res.status} ${await res.text()}`)
  }

  // Organic videos have no budget, so there is nothing to scale. Kept for parity
  // with PublisherPlugin / MetaPublisher.
  async scale(_externalPostId: string, _budgetMultiplier: number): Promise<void> {
    return
  }
}
