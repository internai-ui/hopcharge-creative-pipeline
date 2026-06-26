import path from 'path'
import type { PublisherPlugin } from '../interfaces'
import type { Creative } from '@prisma/client'
import { storage } from '@/lib/storage'

const BASE = 'https://graph.facebook.com/v21.0'

// Fixed daily budget for every ad while testing: ₹97. Budgets are in the
// currency's smallest unit - for INR that's paise (100 paise = ₹1).
const DAILY_BUDGET_PAISE = 9700

// Targeting, resolved from Meta's targeting-search API (stable IDs).
// Delhi as a region covers the whole NCT.
const DELHI_REGION_KEY = '1728'
// Car-brand and EV-owner interests - "various car brands such as tata, mahindra,
// etc. and EV owners". Combined with OR semantics inside a single flexible_spec.
const TARGETING_INTERESTS = [
  { id: '6003319580391', name: 'Tata Motors' },
  { id: '6003397135947', name: 'Mahindra & Mahindra' },
  { id: '6003218688558', name: 'Hyundai Motor Company' },
  { id: '6003166714830', name: 'Kia Motors' },
  { id: '6003125064949', name: 'Electric vehicle' },
  { id: '6003103779434', name: 'Electric car' },
  { id: '6003716067183', name: 'Hybrid electric vehicle' },
  { id: '6003304473660', name: 'SUVs' },
]

export class MetaPublisher implements PublisherPlugin {
  name = 'meta'
  platform = 'meta' as const

  private token = process.env.META_ACCESS_TOKEN!
  private adAccountId = process.env.META_AD_ACCOUNT_ID!
  private pageId = process.env.META_PAGE_ID!
  private campaignId = process.env.META_CAMPAIGN_ID!
  private websiteUrl = process.env.META_WEBSITE_URL ?? 'https://hopcharge.com'
  // Optional click-to-WhatsApp deep link (e.g. https://wa.me/9199XXXXXXXX). When
  // set it's used as the ad's link target; otherwise the CTA routes to the Page's
  // connected WhatsApp number via app_destination.
  private whatsappLink = process.env.META_WHATSAPP_LINK
  // Draft mode (default ON while testing): never set anything to ACTIVE. Ad sets
  // and ads are created PAUSED, so pressing "Post" saves a draft on Meta and
  // counts as a success without spending or going live.
  private draftMode = (process.env.META_DRAFT_MODE ?? 'true') !== 'false'
  // Optional per-funnel campaign overrides. A single campaign can't serve both
  // REACH (awareness objective) and CONVERSATIONS (engagement/leads objective),
  // so map each funnel goal to a campaign whose objective supports it. All fall
  // back to META_CAMPAIGN_ID.
  private reachCampaignId = process.env.META_CAMPAIGN_ID_REACH ?? process.env.META_CAMPAIGN_ID!
  private conversationsCampaignId = process.env.META_CAMPAIGN_ID_CONVERSATIONS ?? process.env.META_CAMPAIGN_ID!

  async publish({
    creative,
    caption,
    headline,
    funnelStage,
    scheduledAt,
    adSchedule,
    targetingOptions,
  }: {
    creative: Creative
    caption?: string
    headline?: string
    funnelStage?: 'TOF' | 'MOF' | 'BOF' | null
    scheduledAt?: Date
    adSchedule?: { days: number[]; startHour: number; endHour: number }
    targetingOptions?: Record<string, unknown>
  }): Promise<{ externalPostId: string; isDraft: boolean }> {
    const filePath = creative.editedFilePath ?? creative.originalFilePath
    if (!filePath) throw new Error('Creative has no file path')

    // Draft mode → always PAUSED (saved, not delivered). Otherwise PAUSED for a
    // future-scheduled post, ACTIVE to go live now.
    const status: 'PAUSED' | 'ACTIVE' = this.draftMode ? 'PAUSED' : (scheduledAt ? 'PAUSED' : 'ACTIVE')

    const adSetId = await this.createAdSet(creative.id, funnelStage, status, scheduledAt, targetingOptions, adSchedule)

    // Image and video creatives use different Meta upload endpoints and ad
    // creative shapes (image_hash + link_data vs. video_id + video_data).
    let adCreativeId: string
    if (creative.mediaType === 'image') {
      const imageHash = await this.uploadImage(filePath)
      adCreativeId = await this.createAdCreative({ imageHash, creativeId: creative.id, caption, headline })
    } else {
      const videoId = await this.uploadVideo(filePath, creative.id)
      adCreativeId = await this.createAdCreative({ videoId, creativeId: creative.id, caption, headline })
    }

    const adId = await this.createAd(creative.id, adSetId, adCreativeId, status)

    return { externalPostId: adId, isDraft: this.draftMode }
  }

  private async uploadVideo(filePath: string, name: string): Promise<string> {
    // Read through the storage abstraction so this works regardless of backend
    // (local disk or S3/R2) - the path is a storage key, not necessarily a file.
    const fileBuffer = await storage.read(filePath)
    const formData = new FormData()
    formData.append('name', name)
    formData.append('source', new Blob([new Uint8Array(fileBuffer)]), path.basename(filePath))

    const res = await fetch(`${BASE}/act_${this.adAccountId}/advideos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    })
    const data = await res.json()
    if (!data.id) throw new Error(`Meta video upload failed: ${JSON.stringify(data)}`)
    return data.id
  }

  // Uploads an image to the ad account's image library and returns its hash,
  // which is referenced by the ad creative's link_data.
  private async uploadImage(filePath: string): Promise<string> {
    const fileBuffer = await storage.read(filePath)
    const filename = path.basename(filePath)
    const formData = new FormData()
    formData.append('filename', new Blob([new Uint8Array(fileBuffer)]), filename)

    const res = await fetch(`${BASE}/act_${this.adAccountId}/adimages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    })
    const data = await res.json()
    // Response shape: { images: { <filename>: { hash, url } } }
    const img = data.images?.[filename] ?? (data.images ? Object.values(data.images)[0] : undefined)
    const hash = (img as { hash?: string } | undefined)?.hash
    if (!hash) throw new Error(`Meta image upload failed: ${JSON.stringify(data)}`)
    return hash
  }

  // Converts day-parting spec → Meta adschedules array.
  // Meta week starts Sunday; start_minute/end_minute are minutes from Sunday midnight.
  private buildAdSchedules(spec: { days: number[]; startHour: number; endHour: number }) {
    return spec.days.map(day => ({
      start_minute: day * 1440 + spec.startHour * 60,
      end_minute: day * 1440 + spec.endHour * 60,
      timezone_type: 'ADVERTISER',
    }))
  }

  private async createAdSet(
    creativeId: string,
    funnelStage: 'TOF' | 'MOF' | 'BOF' | null | undefined,
    status: 'PAUSED' | 'ACTIVE',
    scheduledAt?: Date,
    targetingOptions?: Record<string, unknown>,
    adSchedule?: { days: number[]; startHour: number; endHour: number }
  ): Promise<string> {
    const startTime = scheduledAt ?? new Date()
    const endTime = new Date(startTime.getTime() + 30 * 24 * 60 * 60 * 1000)

    const targeting = targetingOptions?.targeting ?? {
      // Delhi (NCT) region only.
      geo_locations: { regions: [{ key: DELHI_REGION_KEY }] },
      age_min: 25,
      age_max: 55,
      // Car-brand owners and EV owners. flexible_spec = AND across entries,
      // OR within an entry, so one interests entry means "any of these".
      flexible_spec: [{ interests: TARGETING_INTERESTS.map(i => ({ id: i.id, name: i.name })) }],
      publisher_platforms: ['facebook', 'instagram'],
      // NB: the Facebook Reels placement is `facebook_reels` - `reels` is only valid for Instagram.
      facebook_positions: ['feed', 'story', 'facebook_reels'],
      instagram_positions: ['stream', 'story', 'reels'],
      // Meta now requires an explicit Advantage+ audience opt-in/out (0 = use the targeting above as-is).
      targeting_automation: { advantage_audience: 0 },
    }

    // Performance goal by funnel stage: TOF maximizes reach, MOF/BOF maximize
    // WhatsApp conversations. Each needs a campaign whose objective supports it.
    const opt = await this.optimizationForFunnel(funnelStage)
    const campaignId = (targetingOptions?.campaignId ?? opt.campaignId) as string

    const res = await fetch(`${BASE}/act_${this.adAccountId}/adsets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Hopcharge AdSet ${creativeId}`,
        campaign_id: campaignId,
        billing_event: opt.billing_event,
        optimization_goal: opt.optimization_goal,
        // Conversations optimization to WhatsApp needs an explicit destination and
        // a promoted Page object.
        ...(opt.destination_type ? { destination_type: opt.destination_type } : {}),
        ...(opt.promotePage ? { promoted_object: { page_id: this.pageId } } : {}),
        // "Highest volume" - needs no bid amount (a capped strategy would require bid_amount).
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        daily_budget: DAILY_BUDGET_PAISE,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        targeting,
        // Day-parting: pacing_type must be 'day_parting' for adschedules to take effect.
        ...(adSchedule ? {
          adschedules: this.buildAdSchedules(adSchedule),
          pacing_type: ['day_parting'],
        } : {}),
        // PAUSED in draft mode; controlled by META_DRAFT_MODE.
        status,
      }),
    })
    const data = await res.json()
    if (!data.id) throw new Error(`Meta ad set creation failed: ${JSON.stringify(data)}`)
    return data.id
  }

  // Maps a funnel stage to its optimization goal + campaign:
  //   TOF      → REACH               (awareness campaign)
  //   MOF/BOF  → CONVERSATIONS/WA    (engagement or leads campaign, WhatsApp dest)
  // Unknown/null stages fall back to the campaign's own objective so existing
  // single-campaign setups keep working.
  private async optimizationForFunnel(
    funnelStage: 'TOF' | 'MOF' | 'BOF' | null | undefined
  ): Promise<{ optimization_goal: string; billing_event: string; campaignId: string; destination_type?: string; promotePage?: boolean }> {
    if (funnelStage === 'TOF') {
      return { optimization_goal: 'REACH', billing_event: 'IMPRESSIONS', campaignId: this.reachCampaignId }
    }
    if (funnelStage === 'MOF' || funnelStage === 'BOF') {
      return {
        optimization_goal: 'CONVERSATIONS',
        billing_event: 'IMPRESSIONS',
        campaignId: this.conversationsCampaignId,
        destination_type: 'WHATSAPP',
        promotePage: true,
      }
    }
    // Unknown funnel stage: derive a goal compatible with the campaign's objective.
    const campaignId = this.campaignId
    let objective: string | undefined
    try {
      const res = await fetch(`${BASE}/${campaignId}?fields=objective&access_token=${this.token}`)
      objective = (await res.json())?.objective
    } catch {
      // fall through to default
    }
    switch (objective) {
      case 'OUTCOME_AWARENESS': return { optimization_goal: 'REACH', billing_event: 'IMPRESSIONS', campaignId }
      case 'OUTCOME_ENGAGEMENT': return { optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', campaignId, destination_type: 'WHATSAPP', promotePage: true }
      default: return { optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS', campaignId }
    }
  }

  private async createAdCreative(params: {
    videoId?: string
    imageHash?: string
    creativeId: string
    caption?: string
    headline?: string
  }): Promise<string> {
    const { videoId, imageHash, creativeId, caption, headline } = params
    // Every ad uses the "Send WhatsApp Message" CTA. With a WhatsApp deep link we
    // route there directly; otherwise app_destination sends users to the Page's
    // connected WhatsApp number. (The Page must have WhatsApp connected.)
    const callToAction = {
      type: 'WHATSAPP_MESSAGE',
      value: this.whatsappLink
        ? { app_destination: 'WHATSAPP', link: this.whatsappLink }
        : { app_destination: 'WHATSAPP' },
    }
    // link_data requires a link; prefer the WhatsApp deep link, else the website.
    const link = this.whatsappLink ?? this.websiteUrl

    const objectStorySpec = imageHash
      ? {
          page_id: this.pageId,
          link_data: {
            image_hash: imageHash,
            link,
            message: caption,
            ...(headline ? { name: headline } : {}),
            call_to_action: callToAction,
          },
        }
      : {
          page_id: this.pageId,
          video_data: {
            video_id: videoId,
            message: caption,
            ...(headline ? { title: headline } : {}),
            call_to_action: callToAction,
          },
        }

    const res = await fetch(`${BASE}/act_${this.adAccountId}/adcreatives`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Hopcharge Creative ${creativeId}`,
        object_story_spec: objectStorySpec,
      }),
    })
    const data = await res.json()
    if (!data.id) throw new Error(`Meta ad creative creation failed: ${JSON.stringify(data)}`)
    return data.id
  }

  private async createAd(
    creativeId: string,
    adSetId: string,
    adCreativeId: string,
    status: 'PAUSED' | 'ACTIVE'
  ): Promise<string> {
    const res = await fetch(`${BASE}/act_${this.adAccountId}/ads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Hopcharge Ad ${creativeId}`,
        adset_id: adSetId,
        creative: { creative_id: adCreativeId },
        // PAUSED in draft mode so the ad is saved, not delivered.
        status,
      }),
    })
    const data = await res.json()
    if (!data.id) throw new Error(`Meta ad creation failed: ${JSON.stringify(data)}`)
    return data.id
  }

  async pause(externalPostId: string): Promise<void> {
    await fetch(`${BASE}/${externalPostId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'PAUSED' }),
    })
  }

  async scale(externalPostId: string, budgetMultiplier: number): Promise<void> {
    // Budget lives on the ad set, not the ad - look up adset_id first
    const adRes = await fetch(
      `${BASE}/${externalPostId}?fields=adset_id&access_token=${this.token}`
    )
    const adData = await adRes.json()
    if (!adData.adset_id) return

    const adSetId = adData.adset_id
    const budgetRes = await fetch(
      `${BASE}/${adSetId}?fields=daily_budget,lifetime_budget&access_token=${this.token}`
    )
    const budgetData = await budgetRes.json()
    const currentBudget = budgetData.daily_budget ?? budgetData.lifetime_budget
    if (!currentBudget) return

    const newBudget = Math.round(Number(currentBudget) * budgetMultiplier)
    const field = budgetData.daily_budget ? 'daily_budget' : 'lifetime_budget'

    await fetch(`${BASE}/${adSetId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ [field]: newBudget }),
    })
  }
}
