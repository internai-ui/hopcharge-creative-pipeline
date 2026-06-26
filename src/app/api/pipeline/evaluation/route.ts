import { prisma } from '@/lib/db'
import { anthropic as client } from '@/lib/anthropic'

export async function GET() {
  try {
    const [actions, recentIssues, topAds, bottomAds] = await Promise.all([
      prisma.agentAction.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.pipelineIssue.findMany({
        where: { isResolved: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.historicalAd.findMany({
        where: { isSuccessful: true },
        orderBy: { cpl: 'asc' },
        take: 8,
        select: { adName: true, cpl: true, leads: true, spend: true, concepts: true, campaignName: true, dateFrom: true, dateTo: true },
      }),
      prisma.historicalAd.findMany({
        where: { leads: { gt: 0 } },
        orderBy: { cpl: 'desc' },
        take: 8,
        select: { adName: true, cpl: true, leads: true, spend: true, concepts: true, campaignName: true },
      }),
    ])

    const total = actions.length
    const overridden = actions.filter((a) => a.humanOverridden).length
    const overrideRate = total > 0 ? (overridden / total) * 100 : 0
    const withOutcomes = actions.filter((a) => a.outcome)
    const winningOutcomes = withOutcomes.filter((a) => a.outcome === 'winning_creative').length
    const agentWasRight = withOutcomes.length > 0
      ? ((withOutcomes.length - overridden) / withOutcomes.length) * 100
      : 100

    type AdConcepts = { angle?: string; tone?: string }
    type AdRow = { adName: string; cpl: number; leads: number; spend: number; concepts: unknown }

    const formatAd = (a: AdRow) => {
      const c = a.concepts as AdConcepts | null
      return `"${a.adName}" - CPL ₹${a.cpl.toFixed(0)}, ${a.leads} leads, ₹${a.spend.toFixed(0)} spend${c ? ` [angle: ${c.angle ?? '-'}, tone: ${c.tone ?? '-'}]` : ''}`
    }

    const prompt = `You are evaluating Hopcharge's ad creative pipeline. Hopcharge is India's on-demand EV charging service; their ads target urban Delhi-NCR EV owners.

## Active Pipeline Issues (${recentIssues.length})
${recentIssues.length > 0
  ? recentIssues.map(i => `[${i.severity.toUpperCase()}] [${i.stage}] ${i.description}`).join('\n')
  : 'No active issues.'}

## Agent Decisions
- Total: ${total}, Override rate: ${overrideRate.toFixed(1)}%, Known winning outcomes: ${winningOutcomes}
Recent actions:
${actions.slice(0, 15).map(a =>
  `- [${a.actionType}] ${a.decisionRationale.slice(0, 150)}${a.humanOverridden ? ` [OVERRIDDEN: ${a.humanOverrideReason}]` : ''}`
).join('\n')}

## Top Performing Ads (lowest CPL)
${topAds.map(formatAd).join('\n') || 'No data'}

## Worst Performing Ads (highest CPL, with leads)
${bottomAds.map(formatAd).join('\n') || 'No data'}

Write a structured evaluation with these sections:
1. **Pipeline Health** (1-2 sentences on active issues and what to fix)
2. **Why Top Ads Work** (2-3 specific observations about patterns in the best-performing ads - angles, tones, hooks)
3. **Why Bottom Ads Underperform** (2-3 specific observations about what the worst ads have in common)
4. **Actionable Recommendations** (3 concrete things to change in the next round of creative generation)

Be specific, reference actual ad names and metrics. No generic advice.`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    })

    const narrative = response.content[0].type === 'text' ? response.content[0].text : 'Evaluation unavailable.'

    return Response.json({
      summary: {
        totalDecisions: total,
        humanOverrideRate: overrideRate,
        overriddenCount: overridden,
        winningOutcomes,
        agentWasRight,
        activeIssues: recentIssues.length,
      },
      actions,
      narrative,
    })
  } catch (err) {
    return Response.json({ error: 'Evaluation failed', details: String(err) }, { status: 500 })
  }
}
