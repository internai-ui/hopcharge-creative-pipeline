export async function register() {
  // pg-boss uses Node.js APIs; skip in edge runtime and during build
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerJobs } = await import('./lib/jobs')
    await registerJobs().catch((err) => {
      console.error('[instrumentation] Failed to register pg-boss jobs:', err)
    })
  }
}
