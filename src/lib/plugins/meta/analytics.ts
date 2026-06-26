import type { AnalyticsPlugin, PerformanceSnapshot } from '../interfaces'
import { Decimal } from '@prisma/client/runtime/client'

const BASE = 'https://graph.facebook.com/v21.0'

export class MetaAnalytics implements AnalyticsPlugin {
  name = 'meta'

  private token = process.env.META_ACCESS_TOKEN!

  async fetchPerformance({
    externalPostId,
    dateRange,
  }: {
    externalPostId: string
    dateRange: { from: Date; to: Date }
  }): Promise<Omit<PerformanceSnapshot, 'id' | 'createdAt' | 'postId'>> {
    const since = dateRange.from.toISOString().split('T')[0]
    const until = dateRange.to.toISOString().split('T')[0]

    const fields = 'impressions,reach,clicks,spend,cpm,ctr,frequency,actions,cost_per_action_type'
    const url = `${BASE}/${externalPostId}/insights?fields=${fields}&time_range={"since":"${since}","until":"${until}"}&access_token=${this.token}`

    const res = await fetch(url)
    const data = await res.json()

    if (!data.data?.[0]) throw new Error(`Meta analytics returned no data for ${externalPostId}`)

    const d = data.data[0]
    const spend = parseFloat(d.spend ?? '0')
    const impressions = parseInt(d.impressions ?? '0')
    const clicks = parseInt(d.clicks ?? '0')

    // Hopcharge's conversion is a WhatsApp/Messenger lead, not a purchase, so we
    // track cost-per-lead (CPL) and lead count rather than ROAS.
    const leadAction = process.env.META_LEAD_ACTION_TYPE ?? 'onsite_conversion.messaging_conversation_started_7d'
    const cplEntry = d.cost_per_action_type?.find((a: { action_type: string }) => a.action_type === leadAction)
    const leadsEntry = d.actions?.find((a: { action_type: string }) => a.action_type === leadAction)
    const leads = leadsEntry ? parseInt(leadsEntry.value) : 0

    return {
      snapshotDate: dateRange.from,
      impressions,
      reach: parseInt(d.reach ?? '0'),
      clicks,
      spend: new Decimal(spend.toFixed(2)),
      cpl: cplEntry ? new Decimal(parseFloat(cplEntry.value).toFixed(2)) : null,
      leads,
      cpm: new Decimal(parseFloat(d.cpm ?? '0').toFixed(4)),
      ctr: new Decimal(parseFloat(d.ctr ?? '0').toFixed(6)),
      frequency: new Decimal(parseFloat(d.frequency ?? '0').toFixed(4)),
      rawData: data.data[0],
    }
  }
}
