import { anthropic as client } from '@/lib/anthropic'
import { extractJsonObject } from '@/lib/json'
import type { AdConcepts } from './plugins/interfaces'

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
  actions?: Array<{ action_type: string; value: string }>
  cost_per_action_type?: Array<{ action_type: string; value: string }>
  date_start?: string
  date_stop?: string
}

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
      insightsUrl.searchParams.set('fields', 'spend,actions,cost_per_action_type,date_start,date_stop')
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
          isSuccessful,
          concepts: concepts ?? undefined,
        },
      })

      imported++
    } catch {
      errors++
    }
  }

  return { total: ads.length, withLeadData, successful, imported, errors }
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
