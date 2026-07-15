import path from 'path'
import type { PublisherPlugin } from '../interfaces'
import type { Creative } from '@prisma/client'
import { storage } from '@/lib/storage'

// ── YouTube publisher (Google Ads Demand Gen) ────────────────────────────────
//
// The Meta equivalent of a YouTube *ad* is a Google Ads Demand Gen video ad, and
// the equivalent of Meta's PAUSED draft is `status: PAUSED` on the ad. YouTube ads
// must reference a YouTube-hosted video, so the flow is:
//
//   1. OAuth2: exchange the refresh token for an access token (scope: adwords).
//   2. Upload the creative to YouTube via the Google Ads resumable upload service
//      as an UNLISTED video → returns a YouTube video id.
//   3. Create a YoutubeVideoAsset referencing that video id (assets:mutate).
//   4. Create a PAUSED DemandGenVideoAd in a pre-configured Demand Gen ad group
//      (adGroupAds:mutate) — the "draft".
//
// Like MetaPublisher, this reuses a campaign/ad group the operator sets up once in
// the Google Ads UI (targeting/bidding live there), so publishing just adds the ad.
// Your creatives are 9:16 / 1080×1920 — exactly the YouTube Shorts spec — so no
// transcoding is needed; Demand Gen serves them on Shorts.
//
// Requires (see .env.example): GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
// GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID,
// GOOGLE_ADS_AD_GROUP_ID (+ optional GOOGLE_ADS_LOGIN_CUSTOMER_ID, YOUTUBE_CHANNEL_ID).

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://googleads.googleapis.com'
const UPLOAD_API = 'https://googleads.googleapis.com/resumable/upload'

export class YouTubePublisher implements PublisherPlugin {
  name = 'youtube'
  platform = 'youtube' as const

  private developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!
  private clientId = process.env.GOOGLE_ADS_CLIENT_ID!
  private clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET!
  private refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN!
  // Digits only, no dashes.
  private customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
  private loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '')
  private adGroupId = process.env.GOOGLE_ADS_AD_GROUP_ID!
  private channelId = process.env.YOUTUBE_CHANNEL_ID
  private apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? 'v18'
  private finalUrl = process.env.YOUTUBE_FINAL_URL ?? process.env.META_WEBSITE_URL ?? 'https://hopcharge.com'
  private businessName = process.env.YOUTUBE_BUSINESS_NAME ?? 'Hopcharge'
  // Draft mode (default ON while testing): the ad is created PAUSED, so publishing
  // saves a draft in Google Ads without spending or serving — same as Meta.
  private draftMode = (process.env.YOUTUBE_DRAFT_MODE ?? 'true') !== 'false'

  async publish({
    creative,
    caption,
    headline,
  }: {
    creative: Creative
    caption?: string
    headline?: string
    funnelStage?: 'TOF' | 'MOF' | 'BOF' | null
    scheduledAt?: Date
  }): Promise<{ externalPostId: string; isDraft: boolean }> {
    const filePath = creative.editedFilePath ?? creative.originalFilePath
    if (!filePath) throw new Error('Creative has no file path')
    if (creative.mediaType !== 'video') {
      // Demand Gen also supports 9:16 image ads, but this pipeline's YouTube target
      // is Shorts video. Keep the surface small and fail loudly on an image.
      throw new Error('YouTube publishing currently supports video creatives only')
    }

    const token = await this.accessToken()
    const buffer = await storage.read(filePath)

    // 1. Upload to YouTube (unlisted) → video id.
    const videoId = await this.uploadVideo(token, buffer, path.basename(filePath), creative.id, caption)
    // 2. Wrap it as a YoutubeVideoAsset.
    const assetResource = await this.createVideoAsset(token, videoId, creative.id)
    // 3. Create the PAUSED Demand Gen ad.
    const adResource = await this.createDemandGenAd(token, assetResource, caption, headline, creative.id)

    return { externalPostId: adResource, isDraft: this.draftMode }
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

  // ── Resumable YouTube upload (single-request finalize) ──────────────────────
  private async uploadVideo(
    token: string,
    buffer: Buffer,
    filename: string,
    creativeId: string,
    caption?: string,
  ): Promise<string> {
    // Initiate the resumable session and receive the upload URL.
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
            videoTitle: `Hopcharge ${creativeId}`,
            videoDescription: caption ?? 'Hopcharge on-demand EV charging',
            videoPrivacy: 'UNLISTED',
            ...(this.channelId ? { channelId: this.channelId } : {}),
          },
        }),
      },
    )
    const uploadUrl = init.headers.get('x-goog-upload-url')
    if (!uploadUrl) throw new Error(`YouTube upload init failed: ${init.status} ${await init.text()}`)

    // Upload the bytes and finalize in one request.
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
    // The finalize response carries the resulting video id (field name has varied
    // across API versions, so accept the common shapes).
    const videoId: string | undefined =
      data?.youTubeVideoUpload?.videoId ?? data?.videoId ?? data?.resourceName?.split('/').pop()
    if (!videoId) throw new Error(`YouTube upload finalize returned no video id: ${JSON.stringify(data).slice(0, 300)}`)
    return videoId
  }

  // ── Video asset ─────────────────────────────────────────────────────────────
  private async createVideoAsset(token: string, youTubeVideoId: string, creativeId: string): Promise<string> {
    const res = await fetch(`${API}/${this.apiVersion}/customers/${this.customerId}/assets:mutate`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            create: {
              name: `Hopcharge YT ${creativeId}`,
              youtubeVideoAsset: { youtubeVideoId: youTubeVideoId },
            },
          },
        ],
      }),
    })
    const data = await res.json()
    const resource = data?.results?.[0]?.resourceName
    if (!resource) throw new Error(`YouTube video asset creation failed: ${JSON.stringify(data).slice(0, 300)}`)
    return resource
  }

  // ── Demand Gen video ad (PAUSED = draft) ────────────────────────────────────
  private async createDemandGenAd(
    token: string,
    videoAssetResource: string,
    caption: string | undefined,
    headline: string | undefined,
    creativeId: string,
  ): Promise<string> {
    const adGroup = `customers/${this.customerId}/adGroups/${this.adGroupId}`
    const status = this.draftMode ? 'PAUSED' : 'ENABLED'

    const res = await fetch(`${API}/${this.apiVersion}/customers/${this.customerId}/adGroupAds:mutate`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            create: {
              adGroup,
              status,
              ad: {
                name: `Hopcharge Ad ${creativeId}`,
                finalUrls: [this.finalUrl],
                demandGenVideoResponsiveAd: {
                  videos: [{ asset: videoAssetResource }],
                  headlines: [{ text: (headline ?? 'Charge your EV at home').slice(0, 40) }],
                  descriptions: [{ text: (caption ?? 'Hopcharge brings the charger to you.').slice(0, 90) }],
                  businessName: { text: this.businessName },
                  callToActions: [{ text: 'LEARN_MORE' }],
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

  // Budget lives on the Demand Gen campaign, not the ad — no-op here; adjust budget
  // in the Google Ads UI. Kept for interface parity with Meta.
  async scale(_externalPostId: string, _budgetMultiplier: number): Promise<void> {
    return
  }
}
