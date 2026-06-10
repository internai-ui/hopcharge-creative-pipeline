import { syncPerformance } from '@/lib/jobs/sync-performance'

export async function POST() {
  try {
    await syncPerformance()
    return Response.json({ ok: true, message: 'Performance sync complete' })
  } catch (err) {
    return Response.json({ error: 'Sync failed', details: String(err) }, { status: 500 })
  }
}
