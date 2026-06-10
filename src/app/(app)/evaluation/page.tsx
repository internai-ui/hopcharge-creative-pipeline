import { prisma } from '@/lib/db'
import { EvaluationClient } from '@/components/evaluation/EvaluationClient'

export default async function EvaluationPage() {
  const [issues, actions] = await Promise.all([
    prisma.pipelineIssue.findMany({ orderBy: [{ isResolved: 'asc' }, { severity: 'asc' }, { createdAt: 'desc' }] }),
    prisma.agentAction.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  ])

  const total = actions.length
  const overridden = actions.filter((a) => a.humanOverridden).length

  return (
    <EvaluationClient
      initialIssues={issues}
      initialActions={actions}
      totalDecisions={total}
      overriddenCount={overridden}
    />
  )
}
