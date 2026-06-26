import { PgBoss } from 'pg-boss'
import { prisma } from '@/lib/db'
import { isValidCron } from '@/lib/cron'
import { pollCreativeStatus } from './poll-creative-status'
import { syncPerformance } from './sync-performance'
import { runTrendContext } from './trend-context'
import { runFeedbackLoop } from './feedback-loop'
import { reconcilePosts } from './reconcile-posts'

export type JobName =
  | 'poll-creative-status'
  | 'sync-performance'
  | 'trend-context'
  | 'feedback-loop'
  | 'reconcile-posts'

export interface JobDef {
  name: JobName
  label: string
  description: string
  category: string
  cron: string
  run: () => Promise<unknown>
}

// The full catalogue of automatable jobs. Cron defaults can be overridden per
// environment; the UI shows these and lets a human enable/disable each one.
export const JOB_DEFS: JobDef[] = [
  {
    name: 'poll-creative-status',
    label: 'Poll creative status',
    description: 'Checks in-progress video/image generations and downloads finished media into storage.',
    category: 'Production',
    cron: process.env.CRON_POLL_CREATIVES ?? '*/1 * * * *',
    run: pollCreativeStatus,
  },
  {
    name: 'sync-performance',
    label: 'Sync performance',
    description: 'Pulls daily spend / CPL / lead snapshots for live posts and flags creative fatigue.',
    category: 'Analytics',
    cron: process.env.CRON_SYNC_PERFORMANCE ?? '0 */6 * * *',
    run: syncPerformance,
  },
  {
    name: 'trend-context',
    label: 'Refresh trend context',
    description: 'Pulls Google Trends + competitor ads, synthesises market intelligence, and re-scores idea freshness.',
    category: 'Trends',
    cron: process.env.CRON_TREND_CONTEXT ?? '0 6 * * *',
    run: () => runTrendContext(),
  },
  {
    name: 'feedback-loop',
    label: 'Feedback loop',
    description: 'Distills winning/losing patterns from 30-day performance into fresh idea briefs.',
    category: 'Ideas',
    cron: process.env.CRON_FEEDBACK_LOOP ?? '0 8 * * *',
    run: runFeedbackLoop,
  },
  {
    name: 'reconcile-posts',
    label: 'Reconcile posts',
    description: 'Detects ads deleted in Meta Ads Manager after publishing and marks them in the queue.',
    category: 'Publishing',
    cron: process.env.CRON_RECONCILE_POSTS ?? '0 */12 * * *',
    run: reconcilePosts,
  },
]

const JOB_BY_NAME = new Map(JOB_DEFS.map((d) => [d.name, d]))

// Survive dev hot-reloads / route-module re-imports: a fresh PgBoss instance per
// reload would attach duplicate workers to the same queues and run jobs twice.
const globalForBoss = globalThis as unknown as { boss?: PgBoss; workersRegistered?: boolean }

export async function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) {
    const b = new PgBoss(process.env.DATABASE_URL!)
    await b.start()
    globalForBoss.boss = b
  }
  return globalForBoss.boss
}

// Create queues + attach workers exactly once. Workers sit idle until the
// schedule (or a manual send) enqueues a job, so registering them up front is
// cheap and lets us toggle automation purely via schedule/unschedule.
async function ensureRegistered(): Promise<PgBoss> {
  const b = await getBoss()
  if (globalForBoss.workersRegistered) return b
  for (const def of JOB_DEFS) {
    await b.createQueue(def.name).catch(() => {})
    await b.work(def.name, async () => {
      await def.run()
    })
  }
  globalForBoss.workersRegistered = true
  return b
}

export interface AutomationState {
  masterEnabled: boolean
  jobs: Record<JobName, boolean>
  // Per-job cron overrides. Only jobs the user has retimed appear here; everything
  // else uses the env/default cron from JOB_DEFS.
  schedules: Partial<Record<JobName, string>>
}

const defaultJobs = (): Record<JobName, boolean> =>
  Object.fromEntries(JOB_DEFS.map((d) => [d.name, true])) as Record<JobName, boolean>

// The cron a job actually runs on: a saved override if present and valid, else
// the env/default baked into JOB_DEFS.
export function effectiveCron(def: JobDef, schedules: AutomationState['schedules']): string {
  const override = schedules[def.name]
  return override && isValidCron(override) ? override : def.cron
}

// Read the singleton config, creating it on first access. The master default is
// seeded from ENABLE_JOB_AUTOMATION so existing env-based setups carry over.
export async function getAutomationConfig(): Promise<AutomationState> {
  const row = await prisma.automationConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      masterEnabled: process.env.ENABLE_JOB_AUTOMATION === 'true',
      jobs: defaultJobs(),
    },
  })

  // Merge stored flags over defaults so a newly-added job appears enabled.
  const stored = (row.jobs ?? {}) as Record<string, boolean>
  const jobs = defaultJobs()
  for (const name of Object.keys(jobs) as JobName[]) {
    if (typeof stored[name] === 'boolean') jobs[name] = stored[name]
  }

  // Keep only valid cron overrides for known jobs; ignore the rest.
  const storedSchedules = (row.schedules ?? {}) as Record<string, unknown>
  const schedules: Partial<Record<JobName, string>> = {}
  for (const name of Object.keys(jobs) as JobName[]) {
    const cron = storedSchedules[name]
    if (typeof cron === 'string' && isValidCron(cron)) schedules[name] = cron
  }

  return { masterEnabled: row.masterEnabled, jobs, schedules }
}

// Apply a config to pg-boss live: schedule enabled jobs, unschedule the rest.
// Safe to call repeatedly; starts pg-boss on first use.
export async function applyAutomation(state: AutomationState): Promise<void> {
  const b = await ensureRegistered()
  for (const def of JOB_DEFS) {
    const shouldRun = state.masterEnabled && state.jobs[def.name]
    if (shouldRun) {
      await b.schedule(def.name, effectiveCron(def, state.schedules), {})
    } else {
      await b.unschedule(def.name).catch(() => {})
    }
  }
  console.log(
    `[automation] applied master=${state.masterEnabled} ` +
      JOB_DEFS.map((d) => `${d.name}:${state.masterEnabled && state.jobs[d.name] ? 'on' : 'off'}`).join(' '),
  )
}

// Persist a partial change, re-apply it live, and return the resulting state.
export async function updateAutomation(patch: {
  masterEnabled?: boolean
  jobs?: Partial<Record<JobName, boolean>>
  schedules?: Partial<Record<JobName, string>>
}): Promise<AutomationState> {
  const current = await getAutomationConfig()

  // Merge schedule overrides. An empty string clears the override (back to the
  // default cron); a non-empty value must be a valid cron or we reject the whole
  // update so the UI can surface a clear error.
  const schedules: Partial<Record<JobName, string>> = { ...current.schedules }
  for (const [name, cron] of Object.entries(patch.schedules ?? {}) as [JobName, string][]) {
    if (!JOB_BY_NAME.has(name)) continue
    if (cron === '') {
      delete schedules[name]
    } else if (isValidCron(cron)) {
      schedules[name] = cron.trim()
    } else {
      throw new Error(`Invalid cron expression for ${name}: "${cron}"`)
    }
  }

  const next: AutomationState = {
    masterEnabled: patch.masterEnabled ?? current.masterEnabled,
    jobs: { ...current.jobs, ...(patch.jobs ?? {}) },
    schedules,
  }
  await prisma.automationConfig.upsert({
    where: { id: 'singleton' },
    update: { masterEnabled: next.masterEnabled, jobs: next.jobs, schedules: next.schedules },
    create: {
      id: 'singleton',
      masterEnabled: next.masterEnabled,
      jobs: next.jobs,
      schedules: next.schedules,
    },
  })
  await applyAutomation(next)
  return next
}

// Run a single job once, right now, independent of the schedule. Throws on
// unknown name; surfaces the job's own errors to the caller.
export async function runJobNow(name: JobName): Promise<void> {
  const def = JOB_BY_NAME.get(name)
  if (!def) throw new Error(`Unknown job: ${name}`)
  await def.run()
}

// Shape used by the API + UI: static metadata plus current on/off state.
export function describeJobs(state: AutomationState) {
  return JOB_DEFS.map((d) => ({
    name: d.name,
    label: d.label,
    description: d.description,
    category: d.category,
    cron: effectiveCron(d, state.schedules),
    // The env/default cron, so the UI can show "reset to default" vs. a custom value.
    defaultCron: d.cron,
    enabled: state.jobs[d.name],
    scheduled: state.masterEnabled && state.jobs[d.name],
  }))
}

export type JobView = ReturnType<typeof describeJobs>[number]

// Called from src/instrumentation.ts at server startup. When the master switch
// is off we don't even start pg-boss, so "off" truly means nothing runs.
export async function initAutomation(): Promise<void> {
  const config = await getAutomationConfig()
  if (!config.masterEnabled) {
    console.log('[automation] master switch OFF - no jobs scheduled (toggle it in /automation)')
    return
  }
  await applyAutomation(config)
  console.log('[automation] pg-boss jobs registered from saved config')
}
