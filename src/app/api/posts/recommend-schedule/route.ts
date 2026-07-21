import { recommendSchedule } from '@/lib/schedule-recommender'

// GET → a data-driven ad-schedule recommendation (best day-parting window) computed
// from the account's historical CPL-by-hour / by-weekday. The Publish modal calls this
// to pre-fill the day-parting controls.
export async function GET() {
  try {
    const rec = await recommendSchedule()
    return Response.json(rec)
  } catch (err) {
    return Response.json({ error: 'Failed to compute schedule recommendation', details: String(err) }, { status: 500 })
  }
}
