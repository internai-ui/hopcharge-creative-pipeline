export async function register() {
  // pg-boss uses Node.js APIs; skip in edge runtime and during build
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Re-apply whatever automation state was last saved (DB singleton). The master
  // switch and per-job toggles are controlled at runtime from the /automation
  // page; this just restores that state when the server restarts. First boot
  // seeds the master default from ENABLE_JOB_AUTOMATION.
  const { initAutomation } = await import('./lib/jobs')
  await initAutomation().catch((err) => {
    console.error('[instrumentation] automation init failed:', err)
  })
}
