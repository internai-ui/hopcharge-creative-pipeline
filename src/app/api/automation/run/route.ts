import { runJobNow, JOB_DEFS, type JobName } from '@/lib/jobs'

const VALID = new Set(JOB_DEFS.map((d) => d.name))

// Trigger one job immediately, independent of its schedule. Runs inline so the
// response reflects success/failure of the actual job.
export async function POST(req: Request) {
  try {
    const { name } = await req.json().catch(() => ({}))
    if (!name || !VALID.has(name)) {
      return Response.json({ error: `Unknown job: ${name}` }, { status: 400 })
    }
    await runJobNow(name as JobName)
    return Response.json({ ok: true, message: `Ran ${name}` })
  } catch (err) {
    return Response.json({ error: 'Run failed', details: String(err) }, { status: 500 })
  }
}
