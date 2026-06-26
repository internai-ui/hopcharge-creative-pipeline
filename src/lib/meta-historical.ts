import { anthropic as client } from '@/lib/anthropic'
import { extractJsonObject } from '@/lib/json'
import type { AdConcepts } from './plugins/interfaces'
import { logPipelineIssue } from './pipeline-issues'

const BASE = 'https://graph.facebook.com/v21.0'

interface MetaAdCreative {
  body?: string
  title?: string
  description?: string
}

interface MetaAd {
  id: string
  name: string
  campaign?: { name: string }
  adset?: { name: string }
  adcreatives?: { data: MetaAdCreative[] }
}

interface InsightsData {
  spend?: string
  impressions?: string
  reach?: string
  clicks?: string
  cpm?: string
  ctr?: string
  frequency?: string
  actions?: Array<{ action_type: string; value: string }>
  cost_per_action_type?: Array<{ action_type: string; value: string }>
  date_start?: string
  date_stop?: string
}

// Parses the impression-level metrics from a Meta insights row.
export function parseAdMetrics(ins: InsightsData) {
  const num = (v?: string) => (v != null && v !== '' ? Number(v) : null)
  return {
    impressions: ins.impressions != null ? parseInt(ins.impressions) : null,
    reach: ins.reach != null ? parseInt(ins.reach) : null,
    clicks: ins.clicks != null ? parseInt(ins.clicks) : null,
    cpm: num(ins.cpm),
    ctr: num(ins.ctr),
    frequency: num(ins.frequency),
  }
}

export const INSIGHTS_METRIC_FIELDS = 'impressions,reach,clicks,cpm,ctr,frequency'

export interface ImportResult {
  total: number
  withLeadData: number
  successful: number
  imported: number
  errors: number
}

// Lazy import to avoid circular dep and allow prisma to be regenerated
async function getPrisma() {
  const { prisma } = await import('./db')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma as any
}

export async function importHistoricalAds(): Promise<ImportResult> {
  const token = process.env.META_ACCESS_TOKEN
  const accountId = (process.env.META_AD_ACCOUNT_ID ?? '').replace('act_', '')
  const threshold = Number(process.env.CPL_SUCCESS_THRESHOLD ?? 100)

  if (!token || !accountId) {
    throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be set in .env.local')
  }

  const adsUrl = new URL(`${BASE}/act_${accountId}/ads`)
  adsUrl.searchParams.set('fields', 'id,name,campaign{name},adset{name},adcreatives{body,title,description}')
  adsUrl.searchParams.set('limit', '200')
  adsUrl.searchParams.set('access_token', token)

  const adsRes = await fetch(adsUrl.toString())
  const adsData = await adsRes.json() as { data?: MetaAd[]; error?: { message: string } }

  if (adsData.error) {
    throw new Error(`Meta API error: ${adsData.error.message}`)
  }

  const ads = adsData.data ?? []
  let withLeadData = 0, successful = 0, imported = 0, errors = 0
  const db = await getPrisma()

  for (const ad of ads) {
    try {
      const insightsUrl = new URL(`${BASE}/${ad.id}/insights`)
      insightsUrl.searchParams.set('fields', `spend,actions,cost_per_action_type,date_start,date_stop,${INSIGHTS_METRIC_FIELDS}`)
      insightsUrl.searchParams.set('date_preset', 'maximum')
      insightsUrl.searchParams.set('access_token', token)

      const insRes = await fetch(insightsUrl.toString())
      const insData = await insRes.json() as { data?: InsightsData[] }
      const ins: InsightsData = insData.data?.[0] ?? {}

      const leadAction = process.env.META_LEAD_ACTION_TYPE ?? 'onsite_conversion.messaging_conversation_started_7d'
      const cplEntry = ins.cost_per_action_type?.find(a => a.action_type === leadAction)
      if (!cplEntry) continue
      withLeadData++

      const cpl = parseFloat(cplEntry.value)
      const leadsEntry = ins.actions?.find(a => a.action_type === leadAction)
      const leads = leadsEntry ? parseInt(leadsEntry.value) : 0
      const spend = parseFloat(ins.spend ?? '0')
      const metrics = parseAdMetrics(ins)
      const isSuccessful = cpl < threshold

      if (isSuccessful) successful++

      const creative = ad.adcreatives?.data?.[0]
      const bodyText = creative?.body ?? creative?.description ?? ''
      const headlineText = creative?.title ?? ad.name

      let concepts: AdConcepts | null = null
      if (isSuccessful && (bodyText || headlineText)) {
        concepts = await extractConcepts({ adName: ad.name, bodyText, headlineText, cpl })
      }

      const dateFrom = ins.date_start ? new Date(ins.date_start) : new Date('2020-01-01')
      const dateTo = ins.date_stop ? new Date(ins.date_stop) : new Date()

      await db.historicalAd.upsert({
        where: { metaAdId: ad.id },
        create: {
          metaAdId: ad.id,
          adName: ad.name,
          campaignName: ad.campaign?.name,
          adSetName: ad.adset?.name,
          bodyText,
          headlineText,
          cpl,
          leads,
          spend,
          ...metrics,
          isSuccessful,
          concepts: concepts ?? undefined,
          dateFrom,
          dateTo,
          source: 'import',
        },
        update: {
          cpl,
          leads,
          spend,
          ...metrics,
          isSuccessful,
          concepts: concepts ?? undefined,
        },
      })

      imported++
    } catch {
      errors++
    }
  }

  if (errors > 0) {
    await logPipelineIssue({
      severity: errors > 5 ? 'critical' : 'warning',
      stage: 'analytics',
      description: `Meta historical import completed with ${errors} errors out of ${ads.length} ads. ${withLeadData} ads had lead data; ${imported} records upserted.`,
    })
  }

  return { total: ads.length, withLeadData, successful, imported, errors }
}

export interface HourlyRow {
  hour: number
  impressions: number
  spend: number
  leads: number
  cpl: number
}

export interface WeekdayRow {
  day: number   // 0 = Sunday
  impressions: number
  spend: number
  leads: number
  cpl: number
}

export async function fetchAdTimingBreakdowns(
  adId: string,
  token: string,
): Promise<{ hourly: HourlyRow[]; weekday: WeekdayRow[] }> {
  const leadAction = process.env.META_LEAD_ACTION_TYPE ?? 'onsite_conversion.messaging_conversation_started_7d'

  // Hourly breakdown (aggregated over full ad lifetime)
  const hourlyUrl = new URL(`${BASE}/${adId}/insights`)
  hourlyUrl.searchParams.set('breakdowns', 'hourly_stats_aggregated_by_advertiser_time_zone')
  hourlyUrl.searchParams.set('fields', 'spend,impressions,actions,cost_per_action_type')
  hourlyUrl.searchParams.set('date_preset', 'maximum')
  hourlyUrl.searchParams.set('access_token', token)

  const hourlyRes = await fetch(hourlyUrl.toString())
  const hourlyData = await hourlyRes.json() as { data?: Record<string, unknown>[] }

  const hourly: HourlyRow[] = Array.from({ length: 24 }, (_, i) => ({
    hour: i, impressions: 0, spend: 0, leads: 0, cpl: 0,
  }))

  for (const row of (hourlyData.data ?? [])) {
    const hour = parseInt(String(row['hourly_stats_aggregated_by_advertiser_time_zone'] ?? '0'), 10)
    if (hour < 0 || hour > 23) continue
    const actions = row['actions'] as Array<{ action_type: string; value: string }> | undefined
    const cpaEntries = row['cost_per_action_type'] as Array<{ action_type: string; value: string }> | undefined
    const leads = actions?.find(a => a.action_type === leadAction) ? parseInt(actions.find(a => a.action_type === leadAction)!.value) : 0
    const cpl = cpaEntries?.find(a => a.action_type === leadAction) ? parseFloat(cpaEntries.find(a => a.action_type === leadAction)!.value) : 0
    hourly[hour].impressions += parseInt(String(row['impressions'] ?? '0'))
    hourly[hour].spend += parseFloat(String(row['spend'] ?? '0'))
    hourly[hour].leads += leads
    if (cpl > 0) hourly[hour].cpl = (hourly[hour].cpl + cpl) / 2
  }

  // Daily data → aggregate by day of week
  const dailyUrl = new URL(`${BASE}/${adId}/insights`)
  dailyUrl.searchParams.set('time_increment', '1')
  dailyUrl.searchParams.set('fields', 'spend,impressions,actions,cost_per_action_type,date_start')
  dailyUrl.searchParams.set('date_preset', 'maximum')
  dailyUrl.searchParams.set('access_token', token)
  // Paginate up to 180 days so we don't overload the call
  dailyUrl.searchParams.set('limit', '180')

  const dailyRes = await fetch(dailyUrl.toString())
  const dailyData = await dailyRes.json() as { data?: Record<string, unknown>[] }

  const weekdayAcc = Array.from({ length: 7 }, (_, d) => ({
    day: d, impressions: 0, spend: 0, leads: 0, cplSum: 0, count: 0,
  }))

  for (const row of (dailyData.data ?? [])) {
    const dateStr = String(row['date_start'] ?? '')
    if (!dateStr) continue
    const d = new Date(dateStr).getDay()
    const actions = row['actions'] as Array<{ action_type: string; value: string }> | undefined
    const cpaEntries = row['cost_per_action_type'] as Array<{ action_type: string; value: string }> | undefined
    const leads = actions?.find(a => a.action_type === leadAction) ? parseInt(actions.find(a => a.action_type === leadAction)!.value) : 0
    const cpl = cpaEntries?.find(a => a.action_type === leadAction) ? parseFloat(cpaEntries.find(a => a.action_type === leadAction)!.value) : 0
    weekdayAcc[d].impressions += parseInt(String(row['impressions'] ?? '0'))
    weekdayAcc[d].spend += parseFloat(String(row['spend'] ?? '0'))
    weekdayAcc[d].leads += leads
    if (cpl > 0) { weekdayAcc[d].cplSum += cpl; weekdayAcc[d].count++ }
  }

  const weekday: WeekdayRow[] = weekdayAcc.map(v => ({
    day: v.day,
    impressions: v.impressions,
    spend: v.spend,
    leads: v.leads,
    cpl: v.count > 0 ? Math.round(v.cplSum / v.count) : 0,
  }))

  return { hourly, weekday }
}

export async function syncTimingBreakdowns(): Promise<{ updated: number; errors: number }> {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new Error('META_ACCESS_TOKEN must be set')

  const db = await getPrisma()
  const ads = await db.historicalAd.findMany({ select: { id: true, metaAdId: true } })

  // Each ad needs 2 Meta insights calls; doing all of them sequentially over
  // hundreds of ads takes minutes. Run in small concurrent batches instead -
  // fast enough to finish in seconds without tripping Meta's rate limits.
  const CONCURRENCY = 6
  let updated = 0, errors = 0
  for (let i = 0; i < ads.length; i += CONCURRENCY) {
    const batch = ads.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (ad: { id: string; metaAdId: string }) => {
        try {
          const { hourly, weekday } = await fetchAdTimingBreakdowns(ad.metaAdId, token)
          await db.historicalAd.update({
            where: { id: ad.id },
            data: { hourlyBreakdown: hourly, weekdayBreakdown: weekday },
          })
          return true
        } catch {
          return false
        }
      })
    )
    for (const ok of results) { if (ok) updated++; else errors++ }
  }

  if (errors > 0) {
    await logPipelineIssue({
      severity: errors > 5 ? 'warning' : 'info',
      stage: 'analytics',
      description: `Timing sync completed: ${updated} ads updated, ${errors} errors.`,
    })
  }

  return { updated, errors }
}

async function extractConcepts(params: {
  adName: string
  bodyText: string
  headlineText: string
  cpl: number
}): Promise<AdConcepts | null> {
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Extract the creative strategy from this successful Hopcharge ad (cost per WhatsApp conversation: Rs${params.cpl.toFixed(0)}).

Ad: "${params.adName}"
Headline: "${params.headlineText}"
Body: "${params.bodyText.slice(0, 300)}"

Return only valid JSON with no other text:
{"hook":"the opening hook or attention-grabber","angle":"pain_point|social_proof|curiosity_gap|lifestyle|education|values|convenience|problem_solution|discovery","keyMessages":["msg1","msg2"],"tone":"urgent|casual|professional|emotional|educational|humorous","ctaStyle":"brief CTA description"}`,
      }],
    })

    const text = resp.content[0].type === 'text' ? resp.content[0].text : ''
    return extractJsonObject<AdConcepts>(text)
  } catch {
    return null
  }
}

export async function upsertPipelineAd(params: {
  metaAdId: string
  adName: string
  bodyText: string
  headlineText: string
  cpl: number
  leads: number
  spend: number
  snapshotDate: Date
}): Promise<void> {
  const threshold = Number(process.env.CPL_SUCCESS_THRESHOLD ?? 100)
  const isSuccessful = params.cpl < threshold
  const db = await getPrisma()

  let concepts: AdConcepts | null = null
  if (isSuccessful) {
    concepts = await extractConcepts({
      adName: params.adName,
      bodyText: params.bodyText,
      headlineText: params.headlineText,
      cpl: params.cpl,
    })
  }

  await db.historicalAd.upsert({
    where: { metaAdId: params.metaAdId },
    create: {
      metaAdId: params.metaAdId,
      adName: params.adName,
      bodyText: params.bodyText,
      headlineText: params.headlineText,
      cpl: params.cpl,
      leads: params.leads,
      spend: params.spend,
      isSuccessful,
      concepts: concepts ?? undefined,
      dateFrom: params.snapshotDate,
      dateTo: params.snapshotDate,
      source: 'pipeline',
    },
    update: {
      cpl: params.cpl,
      isSuccessful,
      leads: params.leads,
      concepts: isSuccessful && concepts ? concepts : undefined,
    },
  })
}
