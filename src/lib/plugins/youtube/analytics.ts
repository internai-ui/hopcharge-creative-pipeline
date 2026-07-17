import type { AnalyticsPlugin, PerformanceSnapshot } from '../interfaces'
import { Decimal } from '@prisma/client/runtime/client'
import { googleAdsAccessToken, googleAdsSearch } from '../google-ads/client'

// ── YouTube analytics (Google Ads reporting) ─────────────────────────────────
//
// The Meta equivalent - MetaAnalytics - hits the Graph insights API; the YouTube
// equivalent queries the Google Ads reporting API (GAQL) for the Demand Gen ads we
// published. Same shape (AnalyticsPlugin), same output (a PerformanceSnapshot per
// ad), same lead-based model: conversions = leads, cost / conversions = CPL (₹).
//
// Parity notes with MetaAnalytics:
//   • fetchPerformanceBatch: one `WHERE ad_group_ad.ad.id IN (...)` GAQL call covers
//     many ads at once, mirroring Meta's account-level /insights?level=ad batch.
//   • metrics aggregate over the date range (segments.date is filtered but NOT
//     selected), so each ad yields a single snapshot - exactly like Meta's time_range.
//
// Caveat: every ad this app publishes is PAUSED (a draft), and paused ads never
// serve, so they report zeros until someone activates them in Google Ads. Google Ads
// has no ad-level reach/frequency for Demand Gen, so those are left at 0.

type Snapshot = Omit<PerformanceSnapshot, 'id' | 'createdAt' | 'postId'>

// A single GAQL result row (REST returns camelCase; metrics come back as strings).
interface AdRow {
  adGroupAd?: { ad?: { id?: string } }
  metrics?: {
    impressions?: string
    clicks?: string
    costMicros?: string
    conversions?: number | string
    ctr?: number | string
    averageCpm?: string
  }
}

function rowToSnapshot(row: AdRow, snapshotDate: Date): Snapshot {
  const m = row.metrics ?? {}
  const impressions = parseInt(String(m.impressions ?? '0'))
  const clicks = parseInt(String(m.clicks ?? '0'))
  const spend = Number(m.costMicros ?? 0) / 1_000_000 // micros → account currency (₹)
  const leads = Math.round(Number(m.conversions ?? 0)) // conversions == leads (WhatsApp)
  const cpl = leads > 0 ? spend / leads : null

  return {
    snapshotDate,
    impressions,
    reach: 0, // Demand Gen has no ad-level reach in GAQL
    clicks,
    spend: new Decimal(spend.toFixed(2)),
    cpl: cpl != null ? new Decimal(cpl.toFixed(2)) : null,
    leads,
    cpm: new Decimal((Number(m.averageCpm ?? 0) / 1_000_000).toFixed(4)), // micros → ₹
    ctr: new Decimal(Number(m.ctr ?? 0).toFixed(6)), // already a 0–1 ratio
    frequency: new Decimal('0'), // not available at ad level for Demand Gen
    rawData: row as unknown as Snapshot['rawData'],
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function gaqlDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

export class YouTubeAnalytics implements AnalyticsPlugin {
  name = 'youtube'

  private query(ids: string[], dateRange: { from: Date; to: Date }): string {
    const idList = ids.map((id) => `'${id}'`).join(', ')
    return (
      'SELECT ad_group_ad.ad.id, metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
      'metrics.conversions, metrics.ctr, metrics.average_cpm ' +
      'FROM ad_group_ad ' +
      `WHERE ad_group_ad.ad.id IN (${idList}) ` +
      `AND segments.date BETWEEN '${gaqlDate(dateRange.from)}' AND '${gaqlDate(dateRange.to)}'`
    )
  }

  async fetchPerformance({
    externalPostId,
    dateRange,
  }: {
    externalPostId: string
    dateRange: { from: Date; to: Date }
  }): Promise<Snapshot> {
    const token = await googleAdsAccessToken()
    const rows = await googleAdsSearch<AdRow>(this.query([externalPostId], dateRange), token)
    if (rows.length === 0) throw new Error(`Google Ads returned no data for ad ${externalPostId}`)
    return rowToSnapshot(rows[0], dateRange.from)
  }

  // Batch: one GAQL `IN (...)` call per chunk of ad ids, keyed by ad id. Ads with no
  // delivery in the window simply have no entry (mirrors MetaAnalytics batch).
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

    const token = await googleAdsAccessToken()
    for (const group of chunk(ids, 500)) {
      const rows = await googleAdsSearch<AdRow>(this.query(group, dateRange), token)
      for (const row of rows) {
        const id = row.adGroupAd?.ad?.id
        if (id) result.set(String(id), rowToSnapshot(row, dateRange.from))
      }
    }
    return result
  }
}
