import { prisma } from '@/lib/db'
import { IdeasClient } from '@/components/ideas/IdeasClient'

export default async function IdeasPage() {
  const [ideas, latestTrend] = await Promise.all([
    prisma.idea.findMany({ orderBy: { rank: 'asc' } }),
    prisma.trendContext.findFirst({ orderBy: { createdAt: 'desc' } }),
  ])

  // Default the Ideas-page generation toggle to whatever the env is configured for,
  // so a deploy that runs in manual (copy-paste) mode starts with the toggle on.
  const manualDefault =
    process.env.IMAGE_GENERATOR === 'manual' || process.env.VIDEO_GENERATOR === 'manual'

  return <IdeasClient initialIdeas={ideas} latestTrend={latestTrend} manualDefault={manualDefault} />
}
