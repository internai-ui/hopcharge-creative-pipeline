// Shared YouTube Data API v3 helpers: OAuth refresh-token exchange + a JSON GET.
//
// The publisher, analytics and reconcile paths all act as the channel owner using
// the SAME OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, with the YouTube
// Data API v3 enabled) plus a stored refresh token (YOUTUBE_REFRESH_TOKEN) minted
// for the channel owner. A single youtube.force-ssl scope covers upload, read,
// update and delete; youtube.upload + youtube.readonly is the narrower equivalent.

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const DATA_API = 'https://www.googleapis.com/youtube/v3'

/** True when the credentials needed to call the YouTube Data API are all present. */
export function youtubeConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN)
}

export async function youtubeAccessToken(): Promise<string> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Google OAuth failed: ${JSON.stringify(data)}`)
  return data.access_token as string
}

// GET a Data API resource (e.g. videos.list). Throws on an API error payload.
export async function youtubeGet<T = unknown>(
  resource: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${DATA_API}/${resource}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json()
  if (data.error) throw new Error(`YouTube Data API error: ${data.error.message ?? JSON.stringify(data.error)}`)
  return data as T
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// YouTube video ids are 11-char base64url tokens (e.g. "dQw4w9WgXcQ"), unlike the
// all-numeric Meta/Google Ads ad ids. Seed/stub posts use other shapes; this filter
// keeps reconcile + analytics from ever touching a non-real id.
export function isRealYouTubeVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id)
}
