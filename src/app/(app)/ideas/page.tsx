import { prisma } from '@/lib/db'
import { IdeasClient } from '@/components/ideas/IdeasClient'

export default async function IdeasPage() {
  const [ideas, latestTrend] = await Promise.all([
    prisma.idea.findMany({ orderBy: { rank: 'asc' } }),
    prisma.trendContext.findFirst({ orderBy: { createdAt: 'desc' } }),
  ])

  return <IdeasClient initialIdeas={ideas} latestTrend={latestTrend} />
}
