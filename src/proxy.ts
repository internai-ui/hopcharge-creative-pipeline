import { NextRequest, NextResponse } from 'next/server'

export function proxy(_req: NextRequest) {
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
