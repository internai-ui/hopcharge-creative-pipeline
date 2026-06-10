import { prisma } from '@/lib/db'
import { getIdeaGenerator } from '@/lib/plugins/registry'
import { assemblePerformanceContext } from '@/lib/performance-context'
import type { FunnelMode } from '@/lib/plugins/interfaces'
import { NextRequest } from 'next/server'

const VALID_FUNNEL_MODES: FunnelMode[] = ['mix', 'tof', 'mof', 'bof']

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const count = Number(body.count ?? 5)
    const nudge = body.nudge as string | undefined
    const funnelMode: FunnelMode = VALID_FUNNEL_MODES.includes(body.funnelMode) ? body.funnelMode : 'mix'

    const [performanceContext, existingIdeas, currentCount, latestTrend] = await Promise.all([
      assemblePerformanceContext(),
      prisma.idea.findMany({ select: { id: true, title: true } as never }),
      prisma.idea.count(),
      // Trend context is optional — generator works without it
      prisma.trendContext.findFirst({ orderBy: { createdAt: 'desc' } }),
    ])

    const generator = getIdeaGenerator()
    const suggestions = await generator.generateIdeas({
      count,
      nudge,
      existingIdeas: existingIdeas as never,
      performanceContext,
      trendContext: latestTrend ?? undefined,
      funnelMode,
    })

    const topicScores = (latestTrend?.topicScores ?? {}) as Record<string, number>
    const ideas = []

    for (let i = 0; i < suggestions.length; i++) {
      const suggestion = suggestions[i]
      const tagScores = (suggestion.trendTags ?? []).map(
        (tag) => topicScores[tag] ?? topicScores[tag.toLowerCase().replace(/\s+/g, '_')] ?? 0
      )
      const avgScore = tagScores.length > 0 && latestTrend
        ? tagScores.reduce((s, v) => s + v, 0) / tagScores.length
        : null
      const trendWarning =
        avgScore !== null && avgScore < 0.5
          ? `Idea trend score is low (${Math.round(avgScore * 100)}). May be riding outdated trends.`
          : null

      const idea = await prisma.idea.create({
        data: {
          title: suggestion.title,
          hook: suggestion.hook,
          imageVisual: suggestion.imageVisual,
          videoVisual: suggestion.videoVisual,
          cta: suggestion.cta,
          angle: suggestion.angle,
          nudge,
          sourceType: 'ai_generated',
          status: 'pending',
          rank: currentCount + i + 1,
          trendTags: suggestion.trendTags ?? [],
          trendScore: avgScore,
          trendScoredAt: avgScore !== null ? new Date() : null,
          trendWarning,
        },
      })
      ideas.push(idea)
    }

    await prisma.agentAction.create({
      data: {
        actionType: 'idea_generated',
        decisionRationale: `Generated ${ideas.length} ideas. Funnel mode: ${funnelMode}. Trend context: ${latestTrend ? 'yes' : 'skipped'}. Nudge: "${nudge ?? 'none'}". Generator: ${generator.name}.`,
      },
    })

    return Response.json(ideas, { status: 201 })
  } catch (err) {
    return Response.json({ error: 'Failed to generate ideas', details: String(err) }, { status: 500 })
  }
}
