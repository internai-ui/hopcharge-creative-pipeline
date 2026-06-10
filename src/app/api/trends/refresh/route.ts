import { runTrendContext } from '@/lib/jobs/trend-context'

export async function POST() {
  try {
    await runTrendContext()
    return Response.json({ ok: true, message: 'Trend context refreshed' })
  } catch (err) {
    return Response.json({ error: 'Refresh failed', details: String(err) }, { status: 500 })
  }
}
