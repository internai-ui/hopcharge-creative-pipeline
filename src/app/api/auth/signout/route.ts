import { NextRequest, NextResponse } from 'next/server'
import { baseUrl, SESSION_COOKIE } from '@/lib/auth'

// Clears the session and returns to the sign-in page. POST-only (a form submit),
// so a cross-site <img>/link can't force-logout a user. 303 forces the follow-up
// to be a GET of /signin.
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(`${baseUrl(req)}/signin`, 303)
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: baseUrl(req).startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
