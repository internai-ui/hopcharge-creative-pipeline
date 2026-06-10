import type { TrendDataPlugin } from '../interfaces'

// google-trends-api is a CommonJS module; import it carefully
// eslint-disable-next-line @typescript-eslint/no-require-imports
const googleTrends = require('google-trends-api')

export class GoogleTrendsFetcher implements TrendDataPlugin {
  name = 'google'

  async fetchTrends({
    topics,
    region = 'US',
  }: {
    topics: string[]
    region?: string
  }): Promise<{
    scores: Record<string, number>
    risingTopics: string[]
    decliningTopics: string[]
  }> {
    const scores: Record<string, number> = {}
    const now = new Date()
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    // Google Trends API limits to 5 keywords at a time
    const chunks: string[][] = []
    for (let i = 0; i < topics.length; i += 5) chunks.push(topics.slice(i, i + 5))

    for (const chunk of chunks) {
      try {
        const result = await googleTrends.interestOverTime({
          keyword: chunk,
          startTime: ninetyDaysAgo,
          endTime: now,
          geo: region,
        })

        const parsed = JSON.parse(result)
        const timelineData = parsed?.default?.timelineData ?? []

        if (timelineData.length === 0) {
          for (const topic of chunk) scores[topic] = 0
          continue
        }

        // Average the last 4 data points (most recent ~4 weeks)
        const recent = timelineData.slice(-4)
        for (let idx = 0; idx < chunk.length; idx++) {
          const topic = chunk[idx]
          const avg =
            recent.reduce((sum: number, point: { value: number[] }) => sum + (point.value[idx] ?? 0), 0) /
            recent.length
          scores[topic] = Math.round(avg)
        }
      } catch {
        for (const topic of chunk) scores[topic] = 0
      }
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const risingTopics = sorted.filter(([, s]) => s >= 65).map(([t]) => t)
    const decliningTopics = sorted.filter(([, s]) => s < 35).map(([t]) => t)

    return { scores, risingTopics, decliningTopics }
  }
}
