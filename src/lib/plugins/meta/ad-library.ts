import type { AdLibraryPlugin } from '../interfaces'
import { anthropic as client } from '@/lib/anthropic'

const BASE = 'https://graph.facebook.com/v21.0'

export class MetaAdLibraryScraper implements AdLibraryPlugin {
  name = 'meta'

  async fetchCompetitorAds({
    keywords,
    country = 'US',
    limit = 20,
  }: {
    keywords: string[]
    country?: string
    limit?: number
  }): Promise<{ summary: string; ads: Array<{ title: string; description: string; format: string }> }> {
    const token = process.env.META_ACCESS_TOKEN!
    const allAds: Array<{ title: string; description: string; format: string }> = []

    for (const keyword of keywords.slice(0, 3)) {
      const url = `${BASE}/ads_archive?search_terms=${encodeURIComponent(keyword)}&ad_type=ALL&ad_reached_countries=${country}&limit=${limit}&fields=ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_delivery_start_time&access_token=${token}`
      const res = await fetch(url)
      const data = await res.json()

      if (data.data) {
        for (const ad of data.data) {
          const body = ad.ad_creative_bodies?.[0] ?? ''
          allAds.push({
            title: ad.ad_creative_link_captions?.[0] ?? keyword,
            description: body.slice(0, 200),
            format: body.length < 50 ? 'short_copy' : body.length < 150 ? 'medium_copy' : 'long_copy',
          })
        }
      }
    }

    // Ask Claude to synthesize competitor insights
    const synthesisPrompt = `Analyze these competitor Meta ads in the EV charging space and provide strategic insights:

${allAds.map((a, i) => `${i + 1}. "${a.title}": ${a.description}`).join('\n')}

Write 2-3 sentences summarising: what angles/hooks competitors are using, what formats dominate, and any gaps or opportunities you notice. Be specific and actionable.`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: synthesisPrompt }],
    })

    const summary = response.content[0].type === 'text' ? response.content[0].text : 'No competitor data available.'

    return { summary, ads: allAds.slice(0, limit) }
  }
}
