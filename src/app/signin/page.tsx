import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import { SESSION_COOKIE, verifySession, safeNext } from '@/lib/auth'

const ERRORS: Record<string, string> = {
  domain: 'Please sign in with your @hopcharge.com Google account.',
  denied: 'Sign-in was cancelled. Please try again.',
  state: 'Your sign-in attempt expired. Please try again.',
  token: 'We couldn’t complete sign-in with Google. Please try again.',
}

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const sp = await searchParams
  const next = safeNext(sp.next)

  // Already signed in → skip the page.
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value)
  if (session) redirect(next)

  const message = sp.error ? ERRORS[sp.error] ?? 'Sign-in failed. Please try again.' : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-bg px-6">
      <div className="w-full max-w-sm rounded-sm border border-brand-border bg-white p-8 text-center shadow-sm">
        <Image
          src="/hopcharge-logo.svg"
          alt="Hopcharge"
          width={150}
          height={24}
          priority
          className="mx-auto mb-6 h-6 w-auto"
        />
        <h1 className="mb-1 text-lg font-semibold text-brand">Creative Pipeline</h1>
        <p className="mb-6 text-sm text-brand-muted">Sign in with your Hopcharge account to continue.</p>

        {message && (
          <p className="mb-4 rounded-sm border border-brand-accent/30 bg-brand-accent/10 px-3 py-2 text-sm text-brand-accent">
            {message}
          </p>
        )}

        <a href={`/api/auth/signin?next=${encodeURIComponent(next)}`} className="btn-primary w-full">
          <GoogleGlyph />
          Sign in with Google
        </a>

        <p className="mt-6 text-xs text-brand-muted/70">Access is restricted to @hopcharge.com accounts.</p>
      </div>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 4.1 29.3 2 24 2 12.9 2 4 10.9 4 22s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 4.1 29.3 2 24 2 16.3 2 9.7 6.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 42c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 33 26.7 34 24 34c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.6 39.6 16.2 42 24 42z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  )
}
