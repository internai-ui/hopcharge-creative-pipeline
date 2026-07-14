import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/auth'

// Public paths that must NOT require a user session:
//  - /api/auth/*  the OAuth flow itself
//  - /api/cron/*  invoked by Vercel Cron with a CRON_SECRET, not a browser session
const PUBLIC_PREFIXES = ['/api/auth/', '/api/cron/']

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  if (pathname === '/signin' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()

  // Unauthenticated API calls get a clean 401; page requests go to sign-in with a
  // validated return path so the user lands where they intended after logging in.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/signin'
  url.search = `?next=${encodeURIComponent(pathname + search)}`
  return NextResponse.redirect(url)
}

export const config = {
  // Run on every route except Next internals and static files (anything with a dot,
  // e.g. hopcharge-logo.svg / favicon.ico). The public bypass above handles the rest.
  matcher: ['/((?!_next/static|_next/image|.*\\.).*)'],
}
