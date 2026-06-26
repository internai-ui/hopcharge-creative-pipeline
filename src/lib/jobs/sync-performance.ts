import { prisma } from '@/lib/db'
import { getMetaAnalytics } from '@/lib/plugins/registry'
import { upsertPipelineAd } from '@/lib/meta-historical'
import { reconcilePosts } from './reconcile-posts'

export async function syncPerformance(): Promise<void> {
  // First reconcile against Ads Manager: any ad deleted on Meta's side is marked
  // "deleted" here, which also drops it from the "posted" set fetched below.
  await reconcilePosts()

  // Only Meta posts - this job uses the Meta insights API. YouTube posts are
  // synced separately (no YouTube analytics plugin yet).
  const posts = await prisma.post.findMany({
    where: { status: 'posted', externalPostId: { not: null }, platform: 'meta' },
    include: {
      creative: { include: { idea: true } },
      snapshots: { orderBy: { snapshotDate: 'desc' }, take: 10 },
    },
  })

  const analytics = getMetaAnalytics()
  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  for (const post of posts) {
    try {
      const snapshot = await analytics.fetchPerformance({
        externalPostId: post.externalPostId!,
        dateRange: { from: yesterday, to: today },
      })

      await prisma.performanceSnapshot.create({
        data: {
          postId: post.id,
          snapshotDate: snapshot.snapshotDate,
          impressions: snapshot.impressions,
          reach: snapshot.reach,
          clicks: snapshot.clicks,
          spend: snapshot.spend,
          cpl: snapshot.cpl,
          leads: snapshot.leads,
          cpm: snapshot.cpm,
          ctr: snapshot.ctr,
          frequency: snapshot.frequency,
          rawData: snapshot.rawData ?? undefined,
        },
      })

      const threshold = Number(process.env.CPL_SUCCESS_THRESHOLD ?? 100)

      // Update the historical baseline with this snapshot's CPL / leads
      if (snapshot.cpl != null && post.externalPostId) {
        await upsertPipelineAd({
          metaAdId: post.externalPostId,
          adName: post.creative.idea.title,
          bodyText: post.creative.idea.hook,
          headlineText: post.creative.idea.title,
          cpl: Number(snapshot.cpl),
          leads: snapshot.leads,
          spend: Number(snapshot.spend),
          snapshotDate: snapshot.snapshotDate,
        })
      }

      // Fatigue check: frequency > 3 and CPL rose >30% above its best (lowest)
      const allSnaps = [...post.snapshots]
      if (allSnaps.length >= 3) {
        const cpls = allSnaps.map((s) => (s.cpl != null ? Number(s.cpl) : null)).filter((v): v is number => v != null && v > 0)
        const bestCpl = cpls.length ? Math.min(...cpls) : 0
        const latestCpl = allSnaps[0].cpl != null ? Number(allSnaps[0].cpl) : null
        const latestFreq = Number(allSnaps[0].frequency ?? 0)

        if (latestFreq > 3 && bestCpl > 0 && latestCpl != null && latestCpl / bestCpl > 1.3) {
          await prisma.pipelineIssue.create({
            data: {
              severity: 'warning',
              stage: 'analytics',
              description: `Creative fatigue detected on post ${post.id}: frequency ${latestFreq.toFixed(1)}, CPL rose ${Math.round((latestCpl / bestCpl - 1) * 100)}% above best (₹${bestCpl.toFixed(0)} → ₹${latestCpl.toFixed(0)})`,
              relatedEntityId: post.id,
              isResolved: false,
            },
          })
        }

        const lastThree = allSnaps.slice(0, 3)
        if (lastThree.length === 3 && lastThree.every((s) => s.cpl != null && Number(s.cpl) > threshold)) {
          await prisma.pipelineIssue.create({
            data: {
              severity: 'critical',
              stage: 'analytics',
              description: `Post ${post.id} has had CPL above ₹${threshold} for 3 consecutive days`,
              relatedEntityId: post.id,
              isResolved: false,
            },
          })
        }
      }
    } catch (err) {
      await prisma.pipelineIssue.create({
        data: {
          severity: 'warning',
          stage: 'analytics',
          description: `Failed to sync performance for post ${post.id}: ${String(err)}`,
          relatedEntityId: post.id,
          isResolved: false,
        },
      })
    }
  }
}
