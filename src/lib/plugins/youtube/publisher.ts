import type { PublisherPlugin } from '../interfaces'
import type { Creative } from '@prisma/client'
import { storage } from '@/lib/storage'
import { googleAdsSearch } from '../google-ads/client'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── YouTube publisher (Google Ads Demand Gen) ────────────────────────────────
//
// The Meta equivalent of a YouTube *ad* is a Google Ads Demand Gen video ad, and
// the equivalent of Meta's PAUSED draft is a PAUSED ad. YouTube ads must reference
// YouTube-hosted videos, so the flow is:
//
//   1. OAuth2: exchange the refresh token for an access token (scope: adwords).
//   2. Upload each creative video to YouTube (UNLISTED) → YouTube video id.
//   3. Wrap each as a YouTube video asset (assets:mutate, youtubeVideoAsset).
//   4. Create a PAUSED DemandGenVideoResponsiveAd (adGroupAds:mutate) with the
//      video(s) + a required logo asset + business name + several headlines /
//      descriptions + a CTA - the "draft".
//
// Feature parity with MetaPublisher:
//   • funnel stage → ad group. Meta maps funnel to an optimization goal + campaign;
//     Demand Gen keeps audience/bidding on the campaign+ad group, so we select a
//     per-funnel ad group (GOOGLE_ADS_AD_GROUP_ID_{TOF,MOF,BOF}, fallback the
//     default) - the operator sets those up once with the right audience signals,
//     exactly like META_CAMPAIGN_ID_REACH / _CONVERSATIONS.
//   • responsive copy: multiple ytHeadlines (<=40) + ytDescriptions (<=90) + CTA.
//   • "both" aspect ratios: portrait (9:16, originalFilePath) + optional landscape
//     (16:9, landscapeFilePath) ship as two video assets in ONE responsive ad;
//     Google serves the right one per placement (Shorts vs in-stream).
//   • per-publish draft override (draft arg) beats YOUTUBE_DRAFT_MODE.
//
// Requires (see .env.example): the GOOGLE_ADS_* credentials, a per-funnel (or single)
// Demand Gen ad group, and GOOGLE_ADS_LOGO_ASSET_ID (a 1:1 logo image asset the
// operator uploads once - Demand Gen requires a logo, and it must be a raster 1:1,
// not the app's SVG).

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://googleads.googleapis.com'
const UPLOAD_API = 'https://googleads.googleapis.com/resumable/upload'

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

  private developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!
  private clientId = process.env.GOOGLE_ADS_CLIENT_ID!
  private clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET!
  private refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN!
  private customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
  private loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '')
  private defaultAdGroupId = process.env.GOOGLE_ADS_AD_GROUP_ID!
  private logoAssetId = process.env.GOOGLE_ADS_LOGO_ASSET_ID
  private channelId = process.env.YOUTUBE_CHANNEL_ID
  private apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? 'v18'
  private finalUrl = process.env.YOUTUBE_FINAL_URL ?? process.env.META_WEBSITE_URL ?? 'https://hopcharge.com'
  private businessName = process.env.YOUTUBE_BUSINESS_NAME ?? 'Hopcharge'
  private draftMode = (process.env.YOUTUBE_DRAFT_MODE ?? 'true') !== 'false'

  async publish({
    creative,
    caption,
    headline,
    funnelStage,
    ytHeadlines,
    ytDescriptions,
    ytCallToAction,
    draft,
  }: {
    creative: Creative
    caption?: string
    headline?: string
    funnelStage?: 'TOF' | 'MOF' | 'BOF' | null
    scheduledAt?: Date
    ytHeadlines?: string[]
    ytDescriptions?: string[]
    ytCallToAction?: string
    draft?: boolean
  }): Promise<{ externalPostId: string; isDraft: boolean }> {
    const portraitPath = creative.editedFilePath ?? creative.originalFilePath
    if (!portraitPath) throw new Error('Creative has no file path')
    if (creative.mediaType !== 'video') {
      throw new Error('YouTube publishing currently supports video creatives only')
    }
    if (!this.logoAssetId) {
      throw new Error('GOOGLE_ADS_LOGO_ASSET_ID is required (Demand Gen ads need a 1:1 logo image asset)')
    }
    const isDraft = draft ?? this.draftMode
    const token = await this.accessToken()

    // Upload portrait (9:16) and, in "both" mode, the landscape (16:9) rendition.
    const videoAssets: string[] = []
    const portraitId = await this.uploadVideo(token, await storage.read(portraitPath), `${creative.id}-9x16`, caption)
    videoAssets.push(await this.createVideoAsset(token, portraitId, `${creative.id}-portrait`))
    if (creative.landscapeFilePath) {
      const landscapeId = await this.uploadVideo(
        token,
        await storage.read(creative.landscapeFilePath),
        `${creative.id}-16x9`,
        caption,
      )
      videoAssets.push(await this.createVideoAsset(token, landscapeId, `${creative.id}-landscape`))
    }

    const adResource = await this.createDemandGenAd(
      token,
      videoAssets,
      { caption, headline, ytHeadlines, ytDescriptions, ytCallToAction },
      funnelStage,
      isDraft,
      creative.id,
    )
    return { externalPostId: adResource, isDraft }
  }

  // ── OAuth ───────────────────────────────────────────────────────────────────
  private async accessToken(): Promise<string> {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const data = await res.json()
    if (!data.access_token) throw new Error(`Google OAuth failed: ${JSON.stringify(data)}`)
    return data.access_token
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'developer-token': this.developerToken,
      ...(this.loginCustomerId ? { 'login-customer-id': this.loginCustomerId } : {}),
    }
  }

  // Funnel → ad group. The operator sets up one Demand Gen ad group per funnel stage
  // (audience signals + bidding live there), mirroring Meta's per-funnel campaigns.
  private adGroupResource(funnelStage: 'TOF' | 'MOF' | 'BOF' | null | undefined): string {
    const byFunnel =
      funnelStage === 'TOF'
        ? process.env.GOOGLE_ADS_AD_GROUP_ID_TOF
        : funnelStage === 'MOF'
          ? process.env.GOOGLE_ADS_AD_GROUP_ID_MOF
          : funnelStage === 'BOF'
            ? process.env.GOOGLE_ADS_AD_GROUP_ID_BOF
            : undefined
    return `customers/${this.customerId}/adGroups/${byFunnel ?? this.defaultAdGroupId}`
  }

  // ── Resumable YouTube upload (single-request finalize) ──────────────────────
  private async uploadVideo(token: string, buffer: Buffer, label: string, caption?: string): Promise<string> {
    const init = await fetch(
      `${UPLOAD_API}/${this.apiVersion}/customers/${this.customerId}/youTubeVideoUploads:create`,
      {
        method: 'POST',
        headers: {
          ...this.headers(token),
          'Content-Type': 'application/json',
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(buffer.length),
          'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        },
        body: JSON.stringify({
          customerId: this.customerId,
          youTubeVideoUpload: {
            videoTitle: `Hopcharge ${label}`,
            videoDescription: caption ?? 'Hopcharge on-demand EV charging',
            videoPrivacy: 'UNLISTED',
            ...(this.channelId ? { channelId: this.channelId } : {}),
          },
        }),
      },
    )
    const uploadUrl = init.headers.get('x-goog-upload-url')
    if (!uploadUrl) throw new Error(`YouTube upload init failed: ${init.status} ${await init.text()}`)

    const put = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
      },
      body: new Uint8Array(buffer),
    })
    const data = await put.json().catch(() => ({}))

    // The video_id is only populated once YouTube finishes PROCESSING the upload, so
    // the finalize response usually carries just the YouTubeVideoUpload resource name.
    // Use an id if it's already there; otherwise poll the resource until PROCESSED.
    const immediateId: string | undefined = data?.youTubeVideoUpload?.videoId ?? data?.videoId
    if (immediateId) return immediateId
    const resourceName: string | undefined = data?.youTubeVideoUpload?.resourceName ?? data?.resourceName
    if (!resourceName) {
      throw new Error(`YouTube upload finalize returned no resource: ${JSON.stringify(data).slice(0, 300)}`)
    }
    return this.pollUploadForVideoId(token, resourceName, label)
  }

  // Poll the YouTubeVideoUpload resource until it reaches PROCESSED (when video_id is
  // populated). States per the Google Ads docs: PENDING -> UPLOADED -> PROCESSED;
  // FAILED / REJECTED / UNAVAILABLE are terminal errors.
  //
  // NOTE: YouTube processing can take minutes. On Vercel Hobby the publish function is
  // time-capped, so the defaults keep the poll short (tune with YOUTUBE_UPLOAD_POLL_*).
  private async pollUploadForVideoId(token: string, resourceName: string, label: string): Promise<string> {
    const query =
      'SELECT you_tube_video_upload.resource_name, you_tube_video_upload.video_id, you_tube_video_upload.state ' +
      `FROM you_tube_video_upload WHERE you_tube_video_upload.resource_name = '${resourceName}'`
    const maxAttempts = Math.max(1, Number(process.env.YOUTUBE_UPLOAD_POLL_ATTEMPTS ?? 10))
    const intervalMs = Math.max(1000, Number(process.env.YOUTUBE_UPLOAD_POLL_INTERVAL_MS ?? 3000))

    let lastError: unknown = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const rows = await googleAdsSearch<{ youTubeVideoUpload?: { state?: string; videoId?: string } }>(query, token)
        const upload = rows[0]?.youTubeVideoUpload
        if (upload?.state === 'PROCESSED' && upload.videoId) return upload.videoId
        if (upload?.state === 'FAILED' || upload?.state === 'REJECTED' || upload?.state === 'UNAVAILABLE') {
          throw new Error(`YouTube upload ${label} ended in state ${upload.state}`)
        }
      } catch (err) {
        // Terminal-state errors abort; transient query errors just retry next tick.
        if (err instanceof Error && /ended in state/.test(err.message)) throw err
        lastError = err
      }
      await sleep(intervalMs)
    }
    throw new Error(
      `YouTube upload ${label} did not reach PROCESSED after ${maxAttempts} attempts` +
        (lastError ? ` (last error: ${String(lastError)})` : ''),
    )
  }

  // ── Video asset ─────────────────────────────────────────────────────────────
  private async createVideoAsset(token: string, youTubeVideoId: string, name: string): Promise<string> {
    const res = await fetch(`${API}/${this.apiVersion}/customers/${this.customerId}/assets:mutate`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ create: { name: `Hopcharge YT ${name}`, youtubeVideoAsset: { youtubeVideoId: youTubeVideoId } } }],
      }),
    })
    const data = await res.json()
    const resource = data?.results?.[0]?.resourceName
    if (!resource) throw new Error(`YouTube video asset creation failed: ${JSON.stringify(data).slice(0, 300)}`)
    return resource
  }

  // ── Demand Gen responsive video ad (PAUSED = draft) ─────────────────────────
  private async createDemandGenAd(
    token: string,
    videoAssetResources: string[],
    copy: Copy,
    funnelStage: 'TOF' | 'MOF' | 'BOF' | null | undefined,
    isDraft: boolean,
    creativeId: string,
  ): Promise<string> {
    // Responsive: several short headlines/descriptions, else fall back to the
    // Meta copy. Google requires at least one of each; caps and lengths enforced.
    const headlineTexts = (copy.ytHeadlines?.length ? copy.ytHeadlines : [copy.headline ?? 'Charge your EV at home'])
      .slice(0, 5)
      .map((t) => ({ text: t.slice(0, 40) }))
    const descriptionTexts = (copy.ytDescriptions?.length ? copy.ytDescriptions : [copy.caption ?? 'Hopcharge brings the charger to you.'])
      .slice(0, 5)
      .map((t) => ({ text: t.slice(0, 90) }))

    const res = await fetch(`${API}/${this.apiVersion}/customers/${this.customerId}/adGroupAds:mutate`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            create: {
              adGroup: this.adGroupResource(funnelStage),
              status: isDraft ? 'PAUSED' : 'ENABLED',
              ad: {
                name: `Hopcharge Ad ${creativeId}`,
                finalUrls: [this.finalUrl],
                demandGenVideoResponsiveAd: {
                  videos: videoAssetResources.map((asset) => ({ asset })),
                  logoImages: [{ asset: this.logoAssetId }],
                  headlines: headlineTexts,
                  descriptions: descriptionTexts,
                  businessName: { text: this.businessName },
                  callToActions: [{ text: copy.ytCallToAction ?? 'LEARN_MORE' }],
                },
              },
            },
          },
        ],
      }),
    })
    const data = await res.json()
    const resource = data?.results?.[0]?.resourceName
    if (!resource) throw new Error(`Demand Gen ad creation failed: ${JSON.stringify(data).slice(0, 400)}`)
    return resource
  }

  // ── Pause / scale (parity with PublisherPlugin) ─────────────────────────────
  async pause(externalPostId: string): Promise<void> {
    const token = await this.accessToken()
    await fetch(`${API}/${this.apiVersion}/customers/${this.customerId}/adGroupAds:mutate`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ update: { resourceName: externalPostId, status: 'PAUSED' }, updateMask: 'status' }],
      }),
    })
  }

  // Budget lives on the Demand Gen campaign, not the ad - adjust it in the Google
  // Ads UI. Kept for interface parity with Meta.
  async scale(_externalPostId: string, _budgetMultiplier: number): Promise<void> {
    return
  }
}
