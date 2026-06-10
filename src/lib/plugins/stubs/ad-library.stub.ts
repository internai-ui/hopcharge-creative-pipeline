import type { AdLibraryPlugin } from '../interfaces'

export class AdLibraryStub implements AdLibraryPlugin {
  name = 'stub'

  async fetchCompetitorAds(_params: {
    keywords: string[]
    country?: string
    limit?: number
  }): Promise<{ summary: string; ads: Array<{ title: string; description: string; format: string }> }> {
    return {
      summary: `[Stub] Competitor analysis: In the EV charging space, competitors are predominantly running UGC-style testimonials (40%), educational myth-busting content (25%), and convenience-focused short-form videos (20%). Pain-point hooks ("never worry about charge again") consistently outperform aspirational hooks in click-through rates. Most ads are 15-30 seconds. Captions are used in 85% of top-performing ads.`,
      ads: [
        {
          title: 'Charge anywhere, anytime',
          description: 'UGC-style ad showing real customer at charging station, 15s, talking head',
          format: 'ugc_testimonial',
        },
        {
          title: '5 things I wish I knew before going electric',
          description: 'Educational carousel debunking common EV myths',
          format: 'educational_list',
        },
        {
          title: 'Watch me go from 0% to road-ready in 20 minutes',
          description: 'Time-lapse video at fast charger, ambient music, text overlays',
          format: 'timelapse_demonstration',
        },
      ],
    }
  }
}
