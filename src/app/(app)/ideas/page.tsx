import { prisma } from '@/lib/db'
import { IdeasClient } from '@/components/ideas/IdeasClient'

export default async function IdeasPage() {
  const [ideas, latestTrend] = await Promise.all([
    prisma.idea.findMany({ orderBy: { rank: 'asc' } }),
    prisma.trendContext.findFirst({ orderBy: { createdAt: 'desc' } }),
  ])

  // Manual (copy-paste) is the default generation mode - the Ideas-page toggle
  // starts on Manual every session; switching to API generation is a per-session
  // opt-in, not the other way round.
  const manualDefault = true

  return <IdeasClient initialIdeas={ideas} latestTrend={latestTrend} manualDefault={manualDefault} />
}
