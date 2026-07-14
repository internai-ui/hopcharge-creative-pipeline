import { NextRequest, NextResponse } from 'next/server'
import {
  GOOGLE_TOKEN_ENDPOINT,
  clientId,
  clientSecret,
  redirectUri,
  baseUrl,
  isAllowedIdentity,
  signSession,
  safeNext,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  NEXT_COOKIE,
} from '@/lib/auth'

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? ''
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  return JSON.parse(json)
}

// Handles Google's redirect back: validate state, exchange the code, verify the
// identity, and mint our own session cookie. Any failure lands the user back on
// /signin with an error code rather than a stack trace.
export async function GET(req: NextRequest) {
  const base = baseUrl(req)
  const fail = (error: string) => NextResponse.redirect(`${base}/signin?error=${error}`)

  if (req.nextUrl.searchParams.get('error')) return fail('denied')

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const cookieState = req.cookies.get(STATE_COOKIE)?.value
  const verifier = req.cookies.get(VERIFIER_COOKIE)?.value
  const next = safeNext(req.cookies.get(NEXT_COOKIE)?.value)

  // CSRF: the state echoed by Google must match the one we set before redirecting.
  if (!code || !state || !cookieState || state !== cookieState || !verifier) {
    return fail('state')
  }

  // Exchange the authorization code for tokens (server-to-server, over TLS).
  let claims: Record<string, unknown>
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(req),
        code_verifier: verifier,
      }),
    })
    if (!tokenRes.ok) return fail('token')
    const tokens = (await tokenRes.json()) as { id_token?: string }
    if (!tokens.id_token) return fail('token')
    claims = decodeJwtPayload(tokens.id_token)
  } catch {
    return fail('token')
  }

  // The id_token came directly from Google's token endpoint over TLS, so its claims
  // are trusted without re-verifying the signature (OIDC §3.1.3.7). We still check
  // audience / issuer / expiry defensively.
  const validAud = claims.aud === clientId()
  const validIss = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com'
  const notExpired = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now()
  if (!validAud || !validIss || !notExpired) return fail('token')

  // The gate: verified @hopcharge.com Workspace account only.
  if (!isAllowedIdentity(claims)) return fail('domain')

  const session = await signSession({
    sub: String(claims.sub),
    email: String(claims.email),
    name: typeof claims.name === 'string' ? claims.name : undefined,
    picture: typeof claims.picture === 'string' ? claims.picture : undefined,
  })

  const res = NextResponse.redirect(`${base}${next}`)
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: base.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  // Clear the one-time transaction cookies.
  for (const c of [STATE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) {
    res.cookies.set(c, '', { httpOnly: true, path: '/', maxAge: 0 })
  }
  return res
}
