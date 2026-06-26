import type { TrendDataPlugin } from '../interfaces'

// google-trends-api is a CommonJS module; import it carefully
// eslint-disable-next-line @typescript-eslint/no-require-imports
const googleTrends = require('google-trends-api')

// Google Trends normalizes interest to the single highest (keyword, week) point
// WITHIN each request, and the API caps a request at 5 keywords. So scores from
// two different requests are NOT directly comparable - a "60" in a chunk full of
// niche terms and a "60" in a chunk with a blockbuster term mean different things.
//
// To make all topics comparable we put the SAME anchor keyword in every chunk and
// rescale each chunk by how that anchor reads in it. The anchor is a stable,
// reliably-searched term; if it reads low in one chunk (because that chunk had a
// bigger topic compressing everything), we scale that chunk up proportionally.
export class GoogleTrendsFetcher implements TrendDataPlugin {
  name = 'google'

  async fetchTrends({
    topics,
    region = 'IN', // Hopcharge operates in India; callers pass TRENDS_REGION (default IN) too
    anchor,
  }: {
    topics: string[]
    region?: string
    // Optional cross-chunk normalization anchor. When set, every request includes
    // it and the other keywords are rescaled onto a common scale.
    anchor?: string
  }): Promise<{
    scores: Record<string, number>
    risingTopics: string[]
    decliningTopics: string[]
  }> {
    const now = new Date()
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    // Reserve a keyword slot for the anchor when normalizing (4 real + 1 anchor = 5).
    const perChunk = anchor ? 4 : 5
    const chunks: string[][] = []
    for (let i = 0; i < topics.length; i += perChunk) chunks.push(topics.slice(i, i + perChunk))

    // Per-chunk raw averages plus the anchor's reading in that chunk.
    const rawByTopic: Record<string, number> = {}
    const anchorAvgByChunk: number[] = []

    for (const chunk of chunks) {
      const keywords = anchor ? [anchor, ...chunk] : chunk
      try {
        const result = await googleTrends.interestOverTime({
          keyword: keywords,
          startTime: ninetyDaysAgo,
          endTime: now,
          geo: region,
        })

        const parsed = JSON.parse(result)
        const timelineData = parsed?.default?.timelineData ?? []

        if (timelineData.length === 0) {
          anchorAvgByChunk.push(0)
          for (const topic of chunk) rawByTopic[topic] = 0
          continue
        }

        // Average the last 4 data points (most recent ~4 weeks).
        const recent = timelineData.slice(-4)
        const avgAt = (idx: number) =>
          recent.reduce((sum: number, point: { value: number[] }) => sum + (point.value[idx] ?? 0), 0) / recent.length

        if (anchor) {
          anchorAvgByChunk.push(avgAt(0))
          chunk.forEach((topic, i) => { rawByTopic[topic] = avgAt(i + 1) })
        } else {
          chunk.forEach((topic, i) => { rawByTopic[topic] = avgAt(i) })
        }
      } catch {
        anchorAvgByChunk.push(0)
        for (const topic of chunk) rawByTopic[topic] = 0
      }
    }

    // Rescale each chunk onto a common scale using the anchor. Reference = the
    // largest anchor reading we saw (the chunk where the anchor was least
    // compressed); other chunks are scaled up to match it.
    const scores: Record<string, number> = {}
    const refAnchor = anchor ? Math.max(0, ...anchorAvgByChunk.filter((v) => v > 0)) : 0
    chunks.forEach((chunk, ci) => {
      const chunkAnchor = anchorAvgByChunk[ci] ?? 0
      const factor = anchor && refAnchor > 0 && chunkAnchor > 0 ? refAnchor / chunkAnchor : 1
      for (const topic of chunk) scores[topic] = Math.round((rawByTopic[topic] ?? 0) * factor)
    })

    const nonZeroEntries = Object.entries(scores).filter(([, s]) => s > 0)
    const allZero = nonZeroEntries.length === 0

    // Use relative percentile thresholds so we always get useful signal even when
    // absolute scores are low. Guard against the all-zeros case (API blocked/rate-limited).
    let risingTopics: string[] = []
    let decliningTopics: string[] = []

    if (!allZero) {
      const nonZeroScores = nonZeroEntries.map(([, s]) => s).sort((a, b) => a - b)
      const p65 = nonZeroScores[Math.floor(nonZeroScores.length * 0.65)] ?? 50
      const p25 = nonZeroScores[Math.floor(nonZeroScores.length * 0.25)] ?? 20

      // Rising = upper tier of what's actually being searched; declining = lower tier.
      risingTopics = nonZeroEntries.filter(([, s]) => s >= p65).map(([t]) => t)
      decliningTopics = nonZeroEntries.filter(([, s]) => s <= p25).map(([t]) => t)
    }

    return { scores, risingTopics, decliningTopics }
  }
}
