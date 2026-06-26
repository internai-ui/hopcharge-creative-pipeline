import { prisma } from '@/lib/db'
import { getIdeaGenerator } from '@/lib/plugins/registry'
import { assemblePerformanceContext } from '@/lib/performance-context'
import { deriveFirstFrameVisual } from '@/lib/plugins/prompt-constants'

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
          description: 'Feedback loop ran but no TrendContext record exists - run trend-context job first',
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

    // 7. Save new ideas, flagging stale trend tags - built up front so the
    // inserts and the audit log go out as a single batched transaction.
    const baseRank = await prisma.idea.count()
    const now = new Date()
    const data = suggestions.map((suggestion, i) => {
      const tagScores = (suggestion.trendTags ?? []).map(
        (tag) => topicScores[tag] ?? topicScores[tag.toLowerCase().replace(/\s+/g, '_')] ?? 0
      )
      const avgScore = tagScores.length > 0
        ? tagScores.reduce((s, v) => s + v, 0) / tagScores.length
        : null

      const trendWarning =
        avgScore !== null && avgScore < 0.5
          ? `Newly generated idea has low trend score (${Math.round(avgScore * 100)}). The trends it rides may not be current.`
          : null

      return {
        title: suggestion.title,
        hook: suggestion.hook,
        imageVisual: suggestion.imageVisual,
        videoVisual: suggestion.videoVisual,
        videoFirstFrame: suggestion.videoFirstFrame?.trim() || deriveFirstFrameVisual(suggestion.videoVisual),
        cta: suggestion.cta,
        // Required fields - fall back to hook/title if the generator omitted them.
        primaryText: suggestion.primaryText?.trim() || suggestion.hook,
        headline: suggestion.headline?.trim() || suggestion.title,
        angle: suggestion.angle,
        trendTags: suggestion.trendTags ?? [],
        trendScore: avgScore,
        trendScoredAt: avgScore !== null ? now : null,
        trendWarning,
        sourceType: 'ai_generated' as const,
        status: 'pending' as const,
        rank: baseRank + i + 1,
        parentIdeaId: topParentIdeaId,
      }
    })

    // 8. Persist ideas + log agent action in one batched transaction.
    await prisma.$transaction([
      prisma.idea.createMany({ data }),
      prisma.agentAction.create({
        data: {
          actionType: 'idea_generated',
          decisionRationale: `Feedback loop generated ${suggestions.length} new ideas. Winning patterns used: ${performanceContext.winningPatterns.join(', ')}. Patterns avoided: ${performanceContext.patternsToAvoid.join(', ')}.`,
        },
      }),
    ])
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
