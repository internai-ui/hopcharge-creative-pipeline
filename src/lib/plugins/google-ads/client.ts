// Shared Google Ads API helpers: OAuth refresh-token exchange + GAQL searchStream.
// Used by the YouTube analytics + reconcile paths. (The YouTube publisher predates
// this module and keeps its own inline copy so already-shipped code isn't churned.)

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://googleads.googleapis.com'

/** True when the Google Ads credentials needed to make an API call are all present. */
export function googleAdsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID &&
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  )
}

export function googleAdsCustomerId(): string {
  return (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
}

export async function googleAdsAccessToken(): Promise<string> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? '',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Google OAuth failed: ${JSON.stringify(data)}`)
  return data.access_token
}

function headers(token: string): Record<string, string> {
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '')
  return {
    Authorization: `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
    'Content-Type': 'application/json',
    ...(loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
  }
}

// Run a GAQL query via searchStream and return every result row across stream
// batches. Throws on a Google Ads API error (top-level or first stream element).
export async function googleAdsSearch<T = unknown>(query: string, token: string): Promise<T[]> {
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION ?? 'v18'
  const url = `${API}/${apiVersion}/customers/${googleAdsCustomerId()}/googleAds:searchStream`
  const res = await fetch(url, { method: 'POST', headers: headers(token), body: JSON.stringify({ query }) })
  const data = await res.json()
  const err = Array.isArray(data) ? data.find((b) => b?.error)?.error : data?.error
  if (err) throw new Error(`Google Ads query error: ${err.message ?? JSON.stringify(err)}`)
  const batches: { results?: T[] }[] = Array.isArray(data) ? data : [data]
  return batches.flatMap((b) => b.results ?? [])
}
