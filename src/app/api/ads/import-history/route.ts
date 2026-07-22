import { importHistoricalAds } from '@/lib/meta-historical'
import { importYouTubeHistory } from '@/lib/youtube-historical'
import { youtubeConfigured } from '@/lib/plugins/youtube/client'

// Imports ad/video history from BOTH platforms - Meta's paid-ad performance
// (spend/CPL) and YouTube's organic channel uploads (views/likes/comments). Each
// platform is attempted independently so a missing/misconfigured credential on one
// doesn't block the other; per-platform errors are returned rather than thrown.
export async function POST() {
  const result: {
    meta?: Awaited<ReturnType<typeof importHistoricalAds>>
    metaError?: string
    youtube?: Awaited<ReturnType<typeof importYouTubeHistory>>
    youtubeError?: string
  } = {}

  if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
    try {
      result.meta = await importHistoricalAds()
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
    return Response.json({ error: 'Import failed on both platforms', ...result }, { status: 500 })
  }
  return Response.json(result)
}
