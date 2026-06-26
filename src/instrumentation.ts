export async function register() {
  // pg-boss uses Node.js APIs; skip in edge runtime and during build
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Master toggle for background job automation. Default OFF: the pipeline runs
  // in fully-manual mode and every job is still reachable via its API endpoint /
  // UI button. Set ENABLE_JOB_AUTOMATION=true in .env.local to let pg-boss
  // schedule the recurring jobs (poll-creative-status, sync-performance,
  // trend-context, feedback-loop) at server startup.
  if (process.env.ENABLE_JOB_AUTOMATION !== 'true') {
    console.log(
      '[instrumentation] Job automation disabled - set ENABLE_JOB_AUTOMATION=true to enable scheduled pg-boss jobs',
    )
    return
  }

  const { registerJobs } = await import('./lib/jobs')
  await registerJobs().catch((err) => {
    console.error('[instrumentation] Failed to register pg-boss jobs:', err)
  })
}
