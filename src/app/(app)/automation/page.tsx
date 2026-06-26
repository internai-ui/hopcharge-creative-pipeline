import { getAutomationConfig, describeJobs } from '@/lib/jobs'
import { AutomationClient } from '@/components/automation/AutomationClient'

// Always read fresh config (it changes at runtime via the toggle).
export const dynamic = 'force-dynamic'

export default async function AutomationPage() {
  const config = await getAutomationConfig()
  return <AutomationClient initialMaster={config.masterEnabled} initialJobs={describeJobs(config)} />
}
