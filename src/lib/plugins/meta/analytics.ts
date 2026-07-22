import type { AnalyticsPlugin, PerformanceSnapshot } from '../interfaces'
import { Decimal } from '@prisma/client/runtime/client'

const BASE = 'https://graph.facebook.com/v21.0'

type Snapshot = Omit<PerformanceSnapshot, 'id' | 'createdAt' | 'postId'>

// The shape of a single Meta insights row. Metrics come back as strings; leads live
// inside actions[] / cost_per_action_type[].
interface InsightRow {
  ad_id?: string
  impressions?: string
  reach?: string
  clicks?: string
  spend?: string
  cpm?: string
  ctr?: string
  frequency?: string
  actions?: { action_type: string; value: string }[]
  cost_per_action_type?: { action_type: string; value: string }[]
}

const INSIGHT_FIELDS = 'impressions,reach,clicks,spend,cpm,ctr,frequency,actions,cost_per_action_type'

function parseInsightRow(d: InsightRow, snapshotDate: Date): Snapshot {
  const spend = parseFloat(d.spend ?? '0')
  const impressions = parseInt(d.impressions ?? '0')
  const clicks = parseInt(d.clicks ?? '0')

  // Hopcharge's conversion is a WhatsApp/Messenger lead, not a purchase, so we
  // track cost-per-lead (CPL) and lead count rather than ROAS.
  const leadAction = process.env.META_LEAD_ACTION_TYPE ?? 'onsite_conversion.messaging_conversation_started_7d'
  const cplEntry = d.cost_per_action_type?.find((a) => a.action_type === leadAction)
  const leadsEntry = d.actions?.find((a) => a.action_type === leadAction)
  const leads = leadsEntry ? parseInt(leadsEntry.value) : 0

  return {
    snapshotDate,
    impressions,
    reach: parseInt(d.reach ?? '0'),
    clicks,
    spend: new Decimal(spend.toFixed(2)),
    cpl: cplEntry ? new Decimal(parseFloat(cplEntry.value).toFixed(2)) : null,
    leads,
    cpm: new Decimal(parseFloat(d.cpm ?? '0').toFixed(4)),
    ctr: new Decimal(parseFloat(d.ctr ?? '0').toFixed(6)),
    frequency: new Decimal(parseFloat(d.frequency ?? '0').toFixed(4)),
    commentsCount: null, // Meta has no comment-count concept on an ad
    rawData: d as unknown as Snapshot['rawData'],
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export class MetaAnalytics implements AnalyticsPlugin {
  name = 'meta'

  private token = process.env.META_ACCESS_TOKEN!

  // Single-ad insights (used as the fallback path and for one-off lookups).
  async fetchPerformance({
    externalPostId,
    dateRange,
  }: {
    externalPostId: string
    dateRange: { from: Date; to: Date }
  }): Promise<Snapshot> {
    const timeRange = encodeURIComponent(JSON.stringify(rangeStrings(dateRange)))
    const url = `${BASE}/${externalPostId}/insights?fields=${INSIGHT_FIELDS}&time_range=${timeRange}&access_token=${this.token}`

    const res = await fetch(url)
    const data = await res.json()
    if (data.error) throw new Error(`Meta analytics error for ${externalPostId}: ${data.error.message}`)
    if (!data.data?.[0]) throw new Error(`Meta analytics returned no data for ${externalPostId}`)
    return parseInsightRow(data.data[0], dateRange.from)
  }

  // Account-level batch: instead of one HTTP call per ad, hit /act_{id}/insights
  // with level=ad, filtered to just the ads we track, in chunks of 50 ids (one
  // paginated call per chunk). Returns a map keyed by ad id; ads with no delivery
  // in the window simply have no entry.
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

    const accountId = process.env.META_AD_ACCOUNT_ID
    if (!accountId) throw new Error('META_AD_ACCOUNT_ID is not set (required for batch insights)')

    const timeRange = encodeURIComponent(JSON.stringify(rangeStrings(dateRange)))

    for (const group of chunk(ids, 50)) {
      const filtering = encodeURIComponent(
        JSON.stringify([{ field: 'ad.id', operator: 'IN', value: group }]),
      )
      let url: string | null =
        `${BASE}/act_${accountId}/insights?level=ad&fields=ad_id,${INSIGHT_FIELDS}` +
        `&time_range=${timeRange}&filtering=${filtering}&limit=500&access_token=${this.token}`

      // Follow paging.next until the chunk is drained.
      while (url) {
        const res: Response = await fetch(url)
        const data = await res.json()
        if (data.error) throw new Error(`Meta batch insights error: ${data.error.message}`)
        for (const row of (data.data ?? []) as InsightRow[]) {
          if (row.ad_id) result.set(String(row.ad_id), parseInsightRow(row, dateRange.from))
        }
        url = data.paging?.next ?? null
      }
    }
    return result
  }
}

function rangeStrings(dateRange: { from: Date; to: Date }): { since: string; until: string } {
  return {
    since: dateRange.from.toISOString().split('T')[0],
    until: dateRange.to.toISOString().split('T')[0],
  }
}
