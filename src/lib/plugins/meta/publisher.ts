import type { PublisherPlugin } from '../interfaces'
import type { Creative } from '@prisma/client'

const BASE = 'https://graph.facebook.com/v21.0'

export class MetaPublisher implements PublisherPlugin {
  name = 'meta'
  platform = 'meta' as const

  private token = process.env.META_ACCESS_TOKEN!
  private adAccountId = process.env.META_AD_ACCOUNT_ID!

  async publish({
    creative,
    caption,
    scheduledAt,
    targetingOptions,
  }: {
    creative: Creative
    caption?: string
    scheduledAt?: Date
    targetingOptions?: Record<string, unknown>
  }): Promise<{ externalPostId: string }> {
    const filePath = creative.editedFilePath ?? creative.originalFilePath
    if (!filePath) throw new Error('Creative has no file path')

    // Step 1: Upload video to Meta
    const uploadRes = await fetch(
      `${BASE}/act_${this.adAccountId}/advideos`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: creative.id,
          description: caption,
        }),
      }
    )
    const uploadData = await uploadRes.json()
    if (!uploadData.id) throw new Error(`Meta video upload failed: ${JSON.stringify(uploadData)}`)

    // Step 2: Create ad creative
    const creativeRes = await fetch(`${BASE}/act_${this.adAccountId}/adcreatives`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Hopcharge Creative ${creative.id}`,
        object_story_spec: {
          page_id: targetingOptions?.pageId,
          video_data: {
            video_id: uploadData.id,
            message: caption,
            call_to_action: {
              type: 'LEARN_MORE',
            },
          },
        },
      }),
    })
    const creativeData = await creativeRes.json()
    if (!creativeData.id) throw new Error(`Meta creative creation failed: ${JSON.stringify(creativeData)}`)

    // Step 3: Create ad
    const adRes = await fetch(`${BASE}/act_${this.adAccountId}/ads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Hopcharge Ad ${creative.id}`,
        adset_id: targetingOptions?.adSetId,
        creative: { creative_id: creativeData.id },
        status: scheduledAt ? 'PAUSED' : 'ACTIVE',
      }),
    })
    const adData = await adRes.json()
    if (!adData.id) throw new Error(`Meta ad creation failed: ${JSON.stringify(adData)}`)

    return { externalPostId: adData.id }
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
    // Get current budget then scale it
    const res = await fetch(
      `${BASE}/${externalPostId}?fields=daily_budget,lifetime_budget&access_token=${this.token}`
    )
    const data = await res.json()
    const currentBudget = data.daily_budget ?? data.lifetime_budget
    if (!currentBudget) return

    const newBudget = Math.round(currentBudget * budgetMultiplier)
    const field = data.daily_budget ? 'daily_budget' : 'lifetime_budget'

    await fetch(`${BASE}/${externalPostId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ [field]: newBudget }),
    })
  }
}
