import { NextRequest, NextResponse } from 'next/server'
import {
  GOOGLE_AUTH_ENDPOINT,
  clientId,
  redirectUri,
  randomUrlSafe,
  sha256Challenge,
  safeNext,
  ALLOWED_DOMAIN,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  NEXT_COOKIE,
} from '@/lib/auth'

// Starts the Google OAuth 2.0 authorization-code flow (with PKCE + state).
export async function GET(req: NextRequest) {
  const state = randomUrlSafe()
  const verifier = randomUrlSafe(64)
  const challenge = await sha256Challenge(verifier)
  const next = safeNext(req.nextUrl.searchParams.get('next'))

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT)
  authUrl.searchParams.set('client_id', clientId())
  authUrl.searchParams.set('redirect_uri', redirectUri(req))
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('hd', ALLOWED_DOMAIN) // hint Google to show only hopcharge.com accounts
  authUrl.searchParams.set('prompt', 'select_account')
  authUrl.searchParams.set('access_type', 'online')

  const res = NextResponse.redirect(authUrl)
  // Short-lived, HttpOnly transaction cookies. state defends against CSRF; verifier
  // is the PKCE secret that proves this is the same client that started the flow.
  const secure = redirectUri(req).startsWith('https')
  const opts = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  res.cookies.set(STATE_COOKIE, state, opts)
  res.cookies.set(VERIFIER_COOKIE, verifier, opts)
  res.cookies.set(NEXT_COOKIE, next, opts)
  return res
}
