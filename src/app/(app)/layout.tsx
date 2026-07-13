import { Sidebar } from '@/components/layout/Sidebar'

// Every page in this group reads live data from Postgres in a Server Component,
// so none of them can be prerendered at build time (no DB reachable then).
// Applied here once to cover the whole (app) segment.
export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-h-screen overflow-auto bg-brand-bg">{children}</main>
    </div>
  )
}
