import { SignJWT, jwtVerify } from 'jose'

// ── Config ───────────────────────────────────────────────────────────────────
// Only verified Google Workspace accounts on this domain may sign in.
export const ALLOWED_DOMAIN = 'hopcharge.com'

export const SESSION_COOKIE = 'hc_session'
export const STATE_COOKIE = 'hc_oauth_state'
export const VERIFIER_COOKIE = 'hc_oauth_verifier'
export const NEXT_COOKIE = 'hc_oauth_next'

// Session lifetime. Overridable, defaults to 7 days.
export const SESSION_TTL_SECONDS = Math.max(
  300,
  Number(process.env.AUTH_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7),
)

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export interface SessionUser {
  sub: string
  email: string
  name?: string
  picture?: string
}

// ── Env accessors (throw loudly if misconfigured, so we fail closed) ──────────
function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_SECRET is missing or too short (need a random 32+ char string)')
  }
  return new TextEncoder().encode(secret)
}

export function clientId(): string {
  const id = process.env.AUTH_GOOGLE_ID
  if (!id) throw new Error('AUTH_GOOGLE_ID is not set')
  return id
}

export function clientSecret(): string {
  const s = process.env.AUTH_GOOGLE_SECRET
  if (!s) throw new Error('AUTH_GOOGLE_SECRET is not set')
  return s
}

// ── Session token (signed JWT, verified in both Node routes and Edge proxy) ───
export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, picture: user.picture })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey())
}

// Returns the user for a valid, unexpired, untampered token; null otherwise.
// Never throws - a missing secret or bad token both fail closed to "not signed in".
export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] })
    if (!payload.sub || typeof payload.email !== 'string') return null
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    }
  } catch {
    return null
  }
}

// ── The domain gate ───────────────────────────────────────────────────────────
// A user is allowed only if Google says the email is verified, it ends in the
// allowed domain, AND the hosted-domain (hd) claim matches. hd comes straight from
// Google's token endpoint over TLS, so it can't be spoofed by the client.
export function isAllowedIdentity(claims: {
  email?: unknown
  email_verified?: unknown
  hd?: unknown
}): boolean {
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : ''
  return (
    claims.email_verified === true &&
    claims.hd === ALLOWED_DOMAIN &&
    email.endsWith(`@${ALLOWED_DOMAIN}`)
  )
}

// ── URL / PKCE helpers (Web Crypto - works in Node + Edge runtimes) ───────────
// Public origin of the current request, overridable with AUTH_URL. The redirect
// URI built from this must EXACTLY match one registered on the Google client.
export function baseUrl(req: Request): string {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/+$/, '')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export function redirectUri(req: Request): string {
  return `${baseUrl(req)}/api/auth/callback/google`
}

export function randomUrlSafe(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return base64url(arr)
}

export async function sha256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

function base64url(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Only permit relative, single-slash paths as the post-login target (no open redirect).
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/ideas'
  return next
}
