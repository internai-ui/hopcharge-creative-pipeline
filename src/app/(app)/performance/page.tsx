import { prisma } from '@/lib/db'
import { PerformanceClient } from '@/components/performance/PerformanceClient'

export default async function PerformancePage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const snapshots = await prisma.performanceSnapshot.findMany({
    where: { snapshotDate: { gte: thirtyDaysAgo } },
    include: { post: { include: { creative: { include: { idea: true } } } } },
    orderBy: { snapshotDate: 'asc' },
  })

  return <PerformanceClient initialSnapshots={snapshots} />
}
