import { importHistoricalAds } from '@/lib/meta-historical'

export async function POST() {
  try {
    const result = await importHistoricalAds()
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
