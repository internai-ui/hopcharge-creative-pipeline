import { prisma } from '@/lib/db'
import { getIdeaGenerator } from '@/lib/plugins/registry'
import { assemblePerformanceContext } from '@/lib/performance-context'
import { deriveFirstFrameVisual } from '@/lib/plugins/prompt-constants'
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
      // Trend context is optional - generator works without it
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
    const now = new Date()

    // Build all rows up front so the writes go out as a single batched insert
    // (createManyAndReturn) instead of one round-trip per idea.
    const data = suggestions.map((suggestion, i) => {
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

      const validStage = (['TOF', 'MOF', 'BOF'] as const).includes(suggestion.funnelStage as never)
        ? (suggestion.funnelStage as 'TOF' | 'MOF' | 'BOF')
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
        funnelStage: validStage,
        nudge,
        sourceType: 'ai_generated' as const,
        status: 'pending' as const,
        rank: currentCount + i + 1,
        trendTags: suggestion.trendTags ?? [],
        trendScore: avgScore,
        trendScoredAt: avgScore !== null ? now : null,
        trendWarning,
      }
    })

    // One batched insert + the audit log, atomically, in a single round trip.
    const [ideas] = await prisma.$transaction([
      prisma.idea.createManyAndReturn({ data }),
      prisma.agentAction.create({
        data: {
          actionType: 'idea_generated',
          decisionRationale: `Generated ${data.length} ideas. Funnel mode: ${funnelMode}. Trend context: ${latestTrend ? 'yes' : 'skipped'}. Nudge: "${nudge ?? 'none'}". Generator: ${generator.name}.`,
        },
      }),
    ])

    return Response.json(ideas, { status: 201 })
  } catch (err) {
    return Response.json({ error: 'Failed to generate ideas', details: String(err) }, { status: 500 })
  }
}
