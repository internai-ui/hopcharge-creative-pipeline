import { prisma } from '@/lib/db'
import { TrendsClient } from '@/components/trends/TrendsClient'
import type { TrendContext } from '@prisma/client'

type CompetitorAd = { title: string; description: string; format: string }

export default async function TrendsPage() {
  const [trendContexts, ideaScores, latestRaw] = await Promise.all([
    // Omit rawSources - it holds large raw Google Trends / web-search dumps the
    // page never renders, and we pull up to 10 rows here.
    prisma.trendContext.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      omit: { rawSources: true },
    }) as Promise<TrendContext[]>,
    prisma.idea.findMany({
      where: { status: { in: ['pending', 'selected'] } },
      orderBy: { trendScore: 'asc' },
      select: {
        id: true, title: true, trendTags: true, trendScore: true,
        trendWarning: true, trendScoredAt: true, status: true,
      },
    }),
    // Only the latest context's rawSources, just for the competitor ads it captured
    // (the full refresh stores them under rawSources.competitorAds).
    prisma.trendContext.findFirst({ orderBy: { createdAt: 'desc' }, select: { rawSources: true } }),
  ])

  const competitorAds =
    ((latestRaw?.rawSources as { competitorAds?: CompetitorAd[] } | null)?.competitorAds ?? []).slice(0, 20)

  return <TrendsClient trendContexts={trendContexts} ideaScores={ideaScores} competitorAds={competitorAds} />
}
