import { importHistoricalCreativeImages } from '@/lib/meta-historical'

// Pull the actual creative still for each historical ad from the Meta ad account and
// store it. POST with { force: true } to re-download stills that already exist.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const result = await importHistoricalCreativeImages({ force: Boolean(body?.force) })
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
