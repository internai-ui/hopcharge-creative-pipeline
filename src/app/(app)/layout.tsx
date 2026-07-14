import { cookies } from 'next/headers'
import { Sidebar } from '@/components/layout/Sidebar'
import { SESSION_COOKIE, verifySession } from '@/lib/auth'

// Every page in this group reads live data from Postgres in a Server Component,
// so none of them can be prerendered at build time (no DB reachable then).
// Applied here once to cover the whole (app) segment.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Requests only reach here past the auth proxy, but read the session anyway so
  // the sidebar can show who's signed in and offer sign-out.
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value)
  return (
    <div className="flex min-h-screen">
      <Sidebar user={session ? { email: session.email, name: session.name } : null} />
      <main className="flex-1 min-h-screen overflow-auto bg-brand-bg">{children}</main>
    </div>
  )
}
