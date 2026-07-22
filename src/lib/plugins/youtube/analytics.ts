import type { AnalyticsPlugin, PerformanceSnapshot } from '../interfaces'
import { Decimal } from '@prisma/client/runtime/client'
import { youtubeAccessToken, youtubeGet, chunk } from './client'

// ── YouTube analytics (YouTube Data API v3 - organic video statistics) ────────
//
// These are organic YouTube videos, not paid ads: there is no spend, no leads and
// no cost-per-lead. videos.list?part=statistics returns each video's LIFETIME
// cumulative counters (views, likes, comments), so every daily snapshot records the
// running total on that date and the history chart shows the growth curve. (True
// per-day deltas would need the YouTube Analytics API + the yt-analytics.readonly
// scope; the Data API is used here to keep the scope surface small and the call free.)
//
// Mapping onto the shared PerformanceSnapshot (a lead/CPL shape built for Meta):
//   impressions = viewCount     (closest organic analogue to ad impressions)
//   clicks      = likeCount      (engagement proxy; YouTube has no link-click metric)
//   ctr         = likes / views  (engagement rate, kept in the 0-1 ctr field)
//   leads = 0, spend = 0, cpl = null, cpm = 0, reach = 0, frequency = 0  (no ads)
// The full statistics object (views/likes/comments/favorites) is kept in rawData.
//
// Parity with MetaAnalytics: fetchPerformanceBatch does one videos.list?id=a,b,c
// call per 50 ids (the Data API cap), mirroring Meta's account-level batch.

type Snapshot = Omit<PerformanceSnapshot, 'id' | 'createdAt' | 'postId'>

interface VideoRow {
  id?: string
  statistics?: {
    viewCount?: string
    likeCount?: string
    commentCount?: string
    favoriteCount?: string
  }
}

function rowToSnapshot(row: VideoRow, snapshotDate: Date): Snapshot {
  const s = row.statistics ?? {}
  const views = parseInt(String(s.viewCount ?? '0')) || 0
  const likes = parseInt(String(s.likeCount ?? '0')) || 0
  const engagementRate = views > 0 ? likes / views : 0

  return {
    snapshotDate,
    impressions: views,
    reach: 0, // Data API has no unique-viewer count
    clicks: likes,
    spend: new Decimal('0'), // organic - no spend
    cpl: null, // organic - no cost per lead
    leads: 0, // organic - no lead conversions
    cpm: new Decimal('0'),
    ctr: new Decimal(engagementRate.toFixed(6)), // likes / views as an engagement proxy
    frequency: new Decimal('0'),
    rawData: row as unknown as Snapshot['rawData'],
  }
}

export class YouTubeAnalytics implements AnalyticsPlugin {
  name = 'youtube'

  async fetchPerformance({
    externalPostId,
    dateRange,
  }: {
    externalPostId: string
    dateRange: { from: Date; to: Date }
  }): Promise<Snapshot> {
    const token = await youtubeAccessToken()
    const data = await youtubeGet<{ items?: VideoRow[] }>(
      'videos',
      { part: 'statistics', id: externalPostId },
      token,
    )
    const item = data.items?.[0]
    if (!item) throw new Error(`YouTube returned no data for video ${externalPostId}`)
    return rowToSnapshot(item, dateRange.to)
  }

  // Batch: one videos.list?id=... call per 50 ids, keyed by video id. Videos that
  // no longer exist simply have no entry (mirrors MetaAnalytics batch semantics).
  async fetchPerformanceBatch({
    externalPostIds,
    dateRange,
  }: {
    externalPostIds: string[]
    dateRange: { from: Date; to: Date }
  }): Promise<Map<string, Snapshot>> {
    const result = new Map<string, Snapshot>()
    const ids = externalPostIds.filter(Boolean)
    if (ids.length === 0) return result

    const token = await youtubeAccessToken()
    for (const group of chunk(ids, 50)) {
      const data = await youtubeGet<{ items?: VideoRow[] }>(
        'videos',
        { part: 'statistics', id: group.join(','), maxResults: '50' },
        token,
      )
      for (const item of data.items ?? []) {
        if (item.id) result.set(item.id, rowToSnapshot(item, dateRange.to))
      }
    }
    return result
  }
}
