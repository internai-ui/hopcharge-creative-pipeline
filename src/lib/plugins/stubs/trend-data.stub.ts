import type { TrendDataPlugin } from '../interfaces'

const MOCK_SCORES: Record<string, number> = {
  ev_charging: 82,
  home_charging: 74,
  fast_charging: 78,
  road_trips: 88,
  electric_vehicles: 85,
  sustainability: 71,
  clean_energy: 69,
  charging_anxiety: 55,
  ev_range_anxiety: 52,
  ev_fleet: 63,
  ev_lifestyle: 67,
  ugc_style: 79,
  talking_head_format: 72,
  text_on_screen: 65,
  cinematic: 58,
  gas_prices: 61,
  ev_cost_savings: 76,
  road_trip_season: 41,
  urban_ev: 70,
  smart_home: 66,
}

export class TrendDataStub implements TrendDataPlugin {
  name = 'stub'

  async fetchTrends({ topics }: { topics: string[]; region?: string }): Promise<{
    scores: Record<string, number>
    risingTopics: string[]
    decliningTopics: string[]
  }> {
    const scores: Record<string, number> = {}

    for (const topic of topics) {
      const normalized = topic.toLowerCase().replace(/\s+/g, '_')
      scores[topic] = MOCK_SCORES[normalized] ?? Math.floor(30 + Math.random() * 50)
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const risingTopics = sorted.slice(0, Math.ceil(sorted.length * 0.4)).map(([t]) => t)
    const decliningTopics = sorted.slice(-Math.ceil(sorted.length * 0.3)).map(([t]) => t)

    return { scores, risingTopics, decliningTopics }
  }
}
