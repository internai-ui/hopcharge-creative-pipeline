import { prisma } from '@/lib/db'
import { TrendsClient } from '@/components/trends/TrendsClient'

export default async function TrendsPage() {
  const [trendContexts, ideaScores] = await Promise.all([
    prisma.trendContext.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.idea.findMany({
      where: { status: { in: ['pending', 'selected'] } },
      orderBy: { trendScore: 'asc' },
      select: {
        id: true, title: true, trendTags: true, trendScore: true,
        trendWarning: true, trendScoredAt: true, status: true,
      },
    }),
  ])

  return <TrendsClient trendContexts={trendContexts} ideaScores={ideaScores} />
}
