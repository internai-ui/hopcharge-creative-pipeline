import { prisma } from '@/lib/db'
import { getAnalytics } from '@/lib/plugins/registry'
import type { AnalyticsPlugin } from '@/lib/plugins/interfaces'
import { upsertPipelineAd } from '@/lib/meta-historical'
import { reconcilePosts } from './reconcile-posts'

type Snapshot = Awaited<ReturnType<AnalyticsPlugin['fetchPerformance']>>

export async function syncPerformance(): Promise<void> {
  // First reconcile against each platform's ad manager: any ad deleted upstream is
  // marked "deleted" here, which also drops it from the "posted" set fetched below.
  await reconcilePosts()

  // All live posts across platforms. Each platform is synced with its OWN analytics
  // plugin - Meta via the Graph insights API, YouTube via Google Ads reporting -
  // resolved by getAnalytics(platform), mirroring getPublisher(platform).
  const posts = await prisma.post.findMany({
    where: { status: 'posted', externalPostId: { not: null } },
    include: {
      creative: { include: { idea: true } },
      snapshots: { orderBy: { snapshotDate: 'desc' }, take: 10 },
    },
  })

  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const dateRange = { from: yesterday, to: today }
  const threshold = Number(process.env.CPL_SUCCESS_THRESHOLD ?? 100)
  const CONCURRENCY = Math.max(1, Number(process.env.SYNC_CONCURRENCY ?? 6))

  async function syncOne(
    post: (typeof posts)[number],
    analytics: AnalyticsPlugin,
    batch: Map<string, Snapshot> | null,
  ): Promise<void> {
    try {
      const snapshot = batch
        ? batch.get(post.externalPostId!)
        : await analytics.fetchPerformance({ externalPostId: post.externalPostId!, dateRange })
      // No insights for this ad in the window (no delivery, deleted, or filtered out).
      if (!snapshot) return

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
          commentsCount: snapshot.commentsCount,
          rawData: snapshot.rawData ?? undefined,
        },
      })

      // Update the historical baseline with this snapshot's CPL / leads. This baseline
      // is Meta-only (keyed by metaAdId and used to seed the Meta idea generator), so
      // YouTube posts are not fed into it.
      if (post.platform === 'meta' && snapshot.cpl != null && post.externalPostId) {
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

  // Group posts by platform and sync each group with its platform's analytics plugin.
  const groups = new Map<string, (typeof posts)>()
  for (const p of posts) {
    const key = p.platform === 'youtube' ? 'youtube' : 'meta'
    const arr = groups.get(key) ?? []
    arr.push(p)
    groups.set(key, arr)
  }

  for (const [platform, group] of groups) {
    const analytics = getAnalytics(platform)

    // Prefer a single batch call (Meta account-level insights / Google Ads IN query)
    // over one request per post. On failure fall back to per-post fetchPerformance.
    // Plugins without a batch method (the stub) always use per-post.
    let batch: Map<string, Snapshot> | null = null
    if (analytics.fetchPerformanceBatch) {
      try {
        batch = await analytics.fetchPerformanceBatch({
          externalPostIds: group.map((p) => p.externalPostId!).filter(Boolean),
          dateRange,
        })
      } catch (err) {
        console.warn(`[sync] ${platform} batch insights failed, falling back to per-post fetch:`, err)
      }
    }

    // Bounded worker pool: CONCURRENCY workers pull from a shared cursor until drained.
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, group.length) }, async () => {
        while (cursor < group.length) {
          await syncOne(group[cursor++], analytics, batch)
        }
      }),
    )
  }
}
