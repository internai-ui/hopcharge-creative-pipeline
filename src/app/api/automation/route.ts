import { getAutomationConfig, updateAutomation, describeJobs, type JobName } from '@/lib/jobs'

export async function GET() {
  try {
    const config = await getAutomationConfig()
    return Response.json({ masterEnabled: config.masterEnabled, jobs: describeJobs(config) })
  } catch (err) {
    return Response.json({ error: 'Failed to load automation config', details: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const patch: {
      masterEnabled?: boolean
      jobs?: Partial<Record<JobName, boolean>>
      schedules?: Partial<Record<JobName, string>>
    } = {}
    if (typeof body.masterEnabled === 'boolean') patch.masterEnabled = body.masterEnabled
    if (body.jobs && typeof body.jobs === 'object') patch.jobs = body.jobs
    if (body.schedules && typeof body.schedules === 'object') patch.schedules = body.schedules

    const next = await updateAutomation(patch)
    return Response.json({ masterEnabled: next.masterEnabled, jobs: describeJobs(next) })
  } catch (err) {
    return Response.json({ error: 'Failed to update automation', details: String(err) }, { status: 500 })
  }
}
