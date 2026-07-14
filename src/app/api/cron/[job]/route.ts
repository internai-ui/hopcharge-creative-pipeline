import { NextRequest } from 'next/server'
import { runJobNow, getAutomationConfig, JOB_DEFS, type JobName } from '@/lib/jobs'

// Jobs can call Claude / Meta and do real work, so give the function headroom.
// Hobby caps function duration at 60s — heavier jobs (trend synthesis, a large
// performance sync) that need longer require Pro or the always-on host.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const VALID = new Set<string>(JOB_DEFS.map((d) => d.name))

// Vercel Cron invokes this with a GET (user-agent `vercel-cron/1.0`) on the
// schedules declared in vercel.json. It runs the job inline via runJobNow — no
// pg-boss, which can't survive on serverless. The /automation master switch and
// per-job toggles (persisted in Postgres) still gate execution here, so the UI
// controls Vercel Cron exactly as it controls pg-boss on a long-running host.
export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  // Vercel adds `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
  // Enforce it whenever the secret exists — these endpoints trigger paid API work
  // and the rest of the app has no auth, so an open cron path is a real risk.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { job } = await params
  if (!VALID.has(job)) {
    return Response.json({ error: `Unknown job: ${job}` }, { status: 400 })
  }

  const config = await getAutomationConfig()
  if (!config.masterEnabled || !config.jobs[job as JobName]) {
    return Response.json({ ok: true, skipped: true, reason: 'disabled in /automation', job })
  }

  try {
    await runJobNow(job as JobName)
    return Response.json({ ok: true, job })
  } catch (err) {
    return Response.json({ error: 'Job failed', job, details: String(err) }, { status: 500 })
  }
}
