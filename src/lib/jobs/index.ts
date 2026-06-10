import { PgBoss } from 'pg-boss'
import { pollCreativeStatus } from './poll-creative-status'
import { syncPerformance } from './sync-performance'
import { runTrendContext } from './trend-context'
import { runFeedbackLoop } from './feedback-loop'

let boss: PgBoss | null = null

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss(process.env.DATABASE_URL!)
    await boss.start()
  }
  return boss
}

export async function registerJobs(): Promise<void> {
  const b = await getBoss()

  // Queues must exist before workers attach or jobs are scheduled (pg-boss
  // workers start polling immediately and error on a missing queue).
  const queueNames = ['poll-creative-status', 'sync-performance', 'trend-context', 'feedback-loop']
  await Promise.all(queueNames.map((name) => b.createQueue(name)))

  await b.work('poll-creative-status', async () => {
    await pollCreativeStatus()
  })

  await b.work('sync-performance', async () => {
    await syncPerformance()
  })

  await b.work('trend-context', async () => {
    await runTrendContext()
  })

  await b.work('feedback-loop', async () => {
    await runFeedbackLoop()
  })

  // Schedule cron jobs
  const cronPoll = process.env.CRON_POLL_CREATIVES ?? '*/1 * * * *'
  const cronPerf = process.env.CRON_SYNC_PERFORMANCE ?? '0 */6 * * *'
  const cronTrend = process.env.CRON_TREND_CONTEXT ?? '0 6 * * *'
  const cronFeedback = process.env.CRON_FEEDBACK_LOOP ?? '0 8 * * *'

  await b.schedule('poll-creative-status', cronPoll, {})
  await b.schedule('sync-performance', cronPerf, {})
  await b.schedule('trend-context', cronTrend, {})
  await b.schedule('feedback-loop', cronFeedback, {})

  console.log('pg-boss jobs registered')
}
