import { runTrendContext, type TrendMode } from '@/lib/jobs/trend-context'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const mode: TrendMode | undefined = body?.mode === 'lite' || body?.mode === 'full' ? body.mode : undefined
    await runTrendContext(mode)
    return Response.json({ ok: true, message: `Trend context refreshed (${mode ?? 'default'} mode)` })
  } catch (err) {
    return Response.json({ error: 'Refresh failed', details: String(err) }, { status: 500 })
  }
}
