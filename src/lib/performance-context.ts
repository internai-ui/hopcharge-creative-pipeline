import { prisma } from './db'
import type { PerformanceContext, AdConcepts } from './plugins/interfaces'
import type { Idea, PerformanceSnapshot } from '@prisma/client'

function getSnapshotCpl(snap: PerformanceSnapshot): number | null {
  return snap.cpl != null ? Number(snap.cpl) : null
}

async function fetchHistoricalBaseline(): Promise<PerformanceContext['historicalBaseline']> {
  try {
    // prisma.historicalAd is available after db:generate + db:push
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (prisma as any).historicalAd.findMany({
      where: { isSuccessful: true },
      orderBy: { cpl: 'asc' },
      take: 10,
      select: { adName: true, bodyText: true, cpl: true, concepts: true },
    }) as Array<{ adName: string; bodyText: string; cpl: number; concepts: unknown }>

    return rows.map(h => ({
      adName: h.adName,
      bodyText: h.bodyText,
      cpl: h.cpl,
      concepts: h.concepts as AdConcepts | null,
    }))
  } catch {
    return []
  }
}

export async function assemblePerformanceContext(): Promise<PerformanceContext> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const posts = await prisma.post.findMany({
    where: { status: 'posted' },
    include: {
      creative: { include: { idea: true } },
      snapshots: {
        where: { snapshotDate: { gte: thirtyDaysAgo } },
        orderBy: { snapshotDate: 'asc' },
      },
    },
  })

  type PostItem = typeof posts[number]

  const withMetrics = posts
    .filter((p: PostItem) => p.snapshots.length > 0)
    .map((p: PostItem) => {
      const totalSpend = p.snapshots.reduce((s: number, snap: PerformanceSnapshot) => s + Number(snap.spend), 0)
      const cplValues = p.snapshots.map(getSnapshotCpl).filter((v): v is number => v != null && v > 0)
      // Lower CPL is better; posts with no lead data sort last (Infinity).
      const avgCpl = cplValues.length ? cplValues.reduce((s, v) => s + v, 0) / cplValues.length : Infinity
      const avgCtr = p.snapshots.reduce((s: number, snap: PerformanceSnapshot) => s + Number(snap.ctr), 0) / p.snapshots.length

      let daysToFatigue: number | null = null
      for (let i = 1; i < p.snapshots.length; i++) {
        const freq = Number(p.snapshots[i].frequency)
        const initialCpl = getSnapshotCpl(p.snapshots[0])
        const currentCpl = getSnapshotCpl(p.snapshots[i])
        const cplRose = initialCpl != null && initialCpl > 0 && currentCpl != null && currentCpl / initialCpl > 1.3
        if (freq > 3 && cplRose) {
          daysToFatigue = i
          break
        }
      }

      return { post: p, avgCpl, avgCtr, totalSpend, daysToFatigue }
    })
    .sort((a: { avgCpl: number }, b: { avgCpl: number }) => a.avgCpl - b.avgCpl)

  type MetricItem = typeof withMetrics[number]

  const topThree = withMetrics.slice(0, 3)
  const bottomThree = withMetrics.slice(-3).reverse()
  const fatiguers = withMetrics.filter((m: MetricItem): m is MetricItem & { daysToFatigue: number } => m.daysToFatigue !== null)

  const topPerformerDetails: PerformanceContext['topPerformers'] = []
  const poorPerformerDetails: PerformanceContext['poorPerformers'] = []

  // Derive patterns directly from data - no Claude call needed here
  let winningPatterns: string[] = topThree.length > 0
    ? [...new Set(topThree.map((m: MetricItem) => m.post.creative.idea.angle))].slice(0, 3)
    : ['hook_first_3_seconds', 'ugc_style', 'pain_point_angle']

  let patternsToAvoid: string[] = ['overly_polished', 'no_captions', 'long_form']

  for (const m of topThree) {
    topPerformerDetails.push({
      idea: m.post.creative.idea as Idea,
      cpl: Number.isFinite(m.avgCpl) ? m.avgCpl : 0,
      ctr: m.avgCtr,
      fatigueRate: m.daysToFatigue !== null && m.daysToFatigue < 7 ? 'fast' : m.daysToFatigue !== null ? 'slow' : 'none',
      patterns: winningPatterns,
    })
  }

  for (const m of bottomThree) {
    poorPerformerDetails.push({
      idea: m.post.creative.idea as Idea,
      cpl: Number.isFinite(m.avgCpl) ? m.avgCpl : 0,
      failureHypothesis: `High CPL of ₹${Number.isFinite(m.avgCpl) ? m.avgCpl.toFixed(0) : '-'} with angle "${m.post.creative.idea.angle}"`,
    })
  }

  if (poorPerformerDetails.length > 0) {
    patternsToAvoid = [
      ...poorPerformerDetails.map(p => p.idea.angle),
      ...patternsToAvoid,
    ].slice(0, 5)
  }

  const historicalBaseline = await fetchHistoricalBaseline()

  return {
    topPerformers: topPerformerDetails,
    poorPerformers: poorPerformerDetails,
    fastFatiguers: fatiguers.map((m: MetricItem & { daysToFatigue: number }) => ({
      idea: m.post.creative.idea as Idea,
      daysToFatigue: m.daysToFatigue,
    })),
    winningPatterns,
    patternsToAvoid,
    historicalBaseline,
  }
}
