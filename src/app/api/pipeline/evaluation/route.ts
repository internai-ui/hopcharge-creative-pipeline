import { prisma } from '@/lib/db'
import { anthropic as client } from '@/lib/anthropic'
import { createHash } from 'crypto'

const CACHE_KEY = 'pipeline-evaluation'
// The narrative is a pure function of the inputs below, so a matching signature can be
// reused indefinitely - this soft TTL just forces an eventual refresh in case the
// signature misses something. Default 24h; override with EVALUATION_CACHE_TTL_MS.
const CACHE_TTL_MS = Number(process.env.EVALUATION_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000)

export async function GET() {
  try {
    const [actions, recentIssues, topAds, bottomAds] = await Promise.all([
      prisma.agentAction.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.pipelineIssue.findMany({
        where: { isResolved: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      // CPL-based evaluation is inherently a paid-ad (Meta) concept - YouTube rows
      // have no cpl/spend/isSuccessful, so they're excluded rather than sorted in
      // with nulls.
      prisma.historicalAd.findMany({
        where: { platform: 'meta', isSuccessful: true },
        orderBy: { cpl: 'asc' },
        take: 8,
        select: { adName: true, cpl: true, leads: true, spend: true, concepts: true, campaignName: true, dateFrom: true, dateTo: true },
      }),
      prisma.historicalAd.findMany({
        where: { platform: 'meta', leads: { gt: 0 } },
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
    type AdRow = { adName: string; cpl: number | null; leads: number; spend: number | null; concepts: unknown }

    const formatAd = (a: AdRow) => {
      const c = a.concepts as AdConcepts | null
      return `"${a.adName}" - CPL ₹${(a.cpl ?? 0).toFixed(0)}, ${a.leads} leads, ₹${(a.spend ?? 0).toFixed(0)} spend${c ? ` [angle: ${c.angle ?? '-'}, tone: ${c.tone ?? '-'}]` : ''}`
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

    // The prompt is a deterministic function of every input above, so its hash is a
    // perfect cache signature: same inputs -> same prompt -> reuse the last narrative
    // instead of paying for another Claude call on every Evaluation page load.
    const signature = createHash('sha1').update(prompt).digest('hex')

    let narrative: string | null = null
    let cached = false
    try {
      const row = await prisma.cachedResult.findUnique({ where: { key: CACHE_KEY } })
      if (row && row.signature === signature && Date.now() - row.updatedAt.getTime() < CACHE_TTL_MS) {
        const payload = row.payload as { narrative?: string } | null
        if (payload?.narrative) {
          narrative = payload.narrative
          cached = true
        }
      }
    } catch {
      // CachedResult table missing or a transient db error - fall through and compute live.
    }

    if (!narrative) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      })
      narrative = response.content[0].type === 'text' ? response.content[0].text : 'Evaluation unavailable.'
      try {
        await prisma.cachedResult.upsert({
          where: { key: CACHE_KEY },
          create: { key: CACHE_KEY, signature, payload: { narrative } },
          update: { signature, payload: { narrative } },
        })
      } catch {
        // Best-effort cache write; ignore if the table isn't present yet.
      }
    }

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
      cached,
    })
  } catch (err) {
    return Response.json({ error: 'Evaluation failed', details: String(err) }, { status: 500 })
  }
}
