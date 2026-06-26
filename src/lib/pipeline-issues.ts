import { prisma } from './db'

type Severity = 'info' | 'warning' | 'critical'
type Stage = 'idea_generation' | 'trend_analysis' | 'production' | 'review' | 'publishing' | 'analytics' | 'feedback_loop'

export async function logPipelineIssue(params: {
  severity: Severity
  stage: Stage
  description: string
  relatedEntityId?: string
}): Promise<void> {
  try {
    await prisma.pipelineIssue.create({ data: params })
  } catch {
    // Never let logging break the pipeline
  }
}
