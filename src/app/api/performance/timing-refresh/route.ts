import { syncTimingBreakdowns } from '@/lib/meta-historical'

export async function POST() {
  try {
    const result = await syncTimingBreakdowns()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json({ error: 'Timing sync failed', details: String(err) }, { status: 500 })
  }
}
