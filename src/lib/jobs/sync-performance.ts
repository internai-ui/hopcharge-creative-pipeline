import { prisma } from '@/lib/db'
import { getMetaAnalytics } from '@/lib/plugins/registry'
import { upsertPipelineAd } from '@/lib/meta-historical'

export async function syncPerformance(): Promise<void> {
  const posts = await prisma.post.findMany({
    where: { status: 'posted', externalPostId: { not: null } },
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
          roas: snapshot.roas,
          cpm: snapshot.cpm,
          ctr: snapshot.ctr,
          frequency: snapshot.frequency,
          rawData: snapshot.rawData ?? undefined,
        },
      })

      // Extract CPL from rawData and update the historical baseline
      const raw = snapshot.rawData as {
        cost_per_action_type?: Array<{ action_type: string; value: string }>
        actions?: Array<{ action_type: string; value: string }>
      } | null

      const leadAction = process.env.META_LEAD_ACTION_TYPE ?? 'onsite_conversion.messaging_conversation_started_7d'
      const cplEntry = raw?.cost_per_action_type?.find(a => a.action_type === leadAction)
      if (cplEntry && post.externalPostId) {
        const cpl = parseFloat(cplEntry.value)
        const leadsEntry = raw?.actions?.find(a => a.action_type === leadAction)
        const leads = leadsEntry ? parseInt(leadsEntry.value) : 0

        await upsertPipelineAd({
          metaAdId: post.externalPostId,
          adName: post.creative.idea.title,
          bodyText: post.creative.idea.hook,
          headlineText: post.creative.idea.title,
          cpl,
          leads,
          spend: Number(snapshot.spend),
          snapshotDate: snapshot.snapshotDate,
        })
      }

      // Fatigue check: frequency > 3 and ROAS dropped >30% from peak
      const allSnaps = [...post.snapshots]
      if (allSnaps.length >= 3) {
        const peakRoas = Math.max(...allSnaps.map((s) => Number(s.roas ?? 0)))
        const latestRoas = Number(allSnaps[0].roas ?? 0)
        const latestFreq = Number(allSnaps[0].frequency ?? 0)

        if (latestFreq > 3 && peakRoas > 0 && latestRoas / peakRoas < 0.7) {
          await prisma.pipelineIssue.create({
            data: {
              severity: 'warning',
              stage: 'analytics',
              description: `Creative fatigue detected on post ${post.id}: frequency ${latestFreq.toFixed(1)}, ROAS dropped ${Math.round((1 - latestRoas / peakRoas) * 100)}% from peak`,
              relatedEntityId: post.id,
              isResolved: false,
            },
          })
        }

        const lastThree = allSnaps.slice(0, 3)
        if (lastThree.length === 3 && lastThree.every((s) => Number(s.roas ?? 0) < 1.0)) {
          await prisma.pipelineIssue.create({
            data: {
              severity: 'critical',
              stage: 'analytics',
              description: `Post ${post.id} has had ROAS below 1.0 for 3 consecutive days`,
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
