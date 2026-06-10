import { prisma } from '@/lib/db'
import { getIdeaGenerator } from '@/lib/plugins/registry'
import { assemblePerformanceContext } from '@/lib/performance-context'

export async function runFeedbackLoop(): Promise<void> {
  try {
    // 1-4. Assemble performance context (shared with manual generation route)
    const performanceContext = await assemblePerformanceContext()

    // 5. Fetch the latest TrendContext
    const latestTrend = await prisma.trendContext.findFirst({
      orderBy: { createdAt: 'desc' },
    })

    if (!latestTrend) {
      await prisma.pipelineIssue.create({
        data: {
          severity: 'warning',
          stage: 'feedback_loop',
          description: 'Feedback loop ran but no TrendContext record exists — run trend-context job first',
          isResolved: false,
        },
      })
      return
    }

    // 6. Generate new ideas
    const generator = getIdeaGenerator()
    const topParentIdeaId = performanceContext.topPerformers[0]?.idea.id ?? null

    const suggestions = await generator.generateIdeas({
      count: 5,
      performanceContext,
      trendContext: latestTrend,
    })

    const topicScores = latestTrend.topicScores as Record<string, number>

    // 7. Save new ideas, flagging stale trend tags
    let nextRank = await prisma.idea.count()
    for (const suggestion of suggestions) {
      const tagScores = (suggestion.trendTags ?? []).map(
        (tag) => topicScores[tag] ?? topicScores[tag.toLowerCase().replace(/\s+/g, '_')] ?? 0
      )
      const avgScore = tagScores.length > 0
        ? tagScores.reduce((s, v) => s + v, 0) / tagScores.length
        : null

      let trendWarning: string | null = null
      if (avgScore !== null && avgScore < 0.5) {
        trendWarning = `Newly generated idea has low trend score (${Math.round(avgScore * 100)}). The trends it rides may not be current.`
      }

      nextRank++

      await prisma.idea.create({
        data: {
          title: suggestion.title,
          hook: suggestion.hook,
          imageVisual: suggestion.imageVisual,
          videoVisual: suggestion.videoVisual,
          cta: suggestion.cta,
          angle: suggestion.angle,
          trendTags: suggestion.trendTags ?? [],
          trendScore: avgScore,
          trendScoredAt: avgScore !== null ? new Date() : null,
          trendWarning,
          sourceType: 'ai_generated',
          status: 'pending',
          rank: nextRank,
          parentIdeaId: topParentIdeaId,
        },
      })
    }

    // 8. Log agent action
    await prisma.agentAction.create({
      data: {
        actionType: 'idea_generated',
        decisionRationale: `Feedback loop generated ${suggestions.length} new ideas. Winning patterns used: ${performanceContext.winningPatterns.join(', ')}. Patterns avoided: ${performanceContext.patternsToAvoid.join(', ')}.`,
      },
    })
  } catch (err) {
    await prisma.pipelineIssue.create({
      data: {
        severity: 'critical',
        stage: 'feedback_loop',
        description: `Feedback loop job failed: ${String(err)}`,
        isResolved: false,
      },
    })
  }
}
