import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { getTrendData, getWebSearch, getAdLibrary } from '@/lib/plugins/registry'
import { anthropic as client } from '@/lib/anthropic'
import { extractJsonObject } from '@/lib/json'
import {
  DEMAND_TOPICS, CHARGING_TOPICS, LIFESTYLE_TOPICS, CONTENT_FORMAT_TOPICS,
  TOPIC_GROUPS, ALL_TOPICS, TRENDS_ANCHOR,
} from '@/lib/trend-topics'

// Shape Claude returns for the synthesized trend context (see synthesisPrompt).
interface TrendAnalysis {
  summary: string
  risingTopics: { topic: string; rationale: string; googleTrendsScore: number }[]
  decliningTopics: { topic: string; rationale: string; googleTrendsScore: number }[]
  platformFormatTrends: { format: string; trend: string; notes: string }[]
  culturalMoments?: { moment: string; relevance: string; urgency: string }[]
  competitorAdInsights: string
  topicScores: Record<string, number>
}

// Topic taxonomy + anchor live in a dependency-free module so the trends page can
// render the same content-format list. See src/lib/trend-topics.ts.

type FormatTrend = { format: string; trend: 'rising' | 'stable' | 'declining'; notes: string }

// Cold-start ad-format guidance. Google Trends can't measure how image/video ads
// actually perform, so before any full refresh has run, lite mode seeds the table
// with this curated baseline. Once a full refresh exists, lite mode carries THAT
// forward instead (see latestFullFormatTrends) - the baseline is only a seed.
const AD_FORMAT_BASELINE: FormatTrend[] = [
  { format: 'UGC / talking-head testimonial (vertical video)', trend: 'rising',
    notes: 'Authentic phone-shot style consistently beats polished brand films on Reels & Shorts in India.' },
  { format: 'Fast-cut problem→solution Reel, bold on-screen captions', trend: 'rising',
    notes: '15-20s, captioned for sound-off viewing. Strong for MOF "no home charger?" angles.' },
  { format: 'Cost-comparison / before-after static carousel', trend: 'stable',
    notes: 'Reliable for BOF price & savings angles (₹/km vs petrol).' },
  { format: 'Cinematic 30s+ brand film', trend: 'declining',
    notes: 'Higher production cost and lower completion rate than UGC in mobile feeds.' },
]

export type TrendMode = 'lite' | 'full'

// Thrown when a quick (lite) refresh comes back empty (Google Trends rate-limited).
// We discard these: nothing is persisted and no pipeline issue is logged, so a
// failed quick refresh leaves no trace in the topic score history or anywhere else.
export class QuickRefreshDiscardedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuickRefreshDiscardedError'
  }
}

type TrendData = { scores: Record<string, number>; risingTopics: string[]; decliningTopics: string[] }

// Score every topic RELATIVE TO ITS GROUP's hottest topic, so each lens lands on a
// 0-1 scale where 1.0 = the most-searched topic in that lens. This is what makes
// staleness meaningful for a niche business: an idea is only "stale" if it rides
// topics that are cold *relative to its peers*, not merely low in absolute volume.
function relativeScoresByGroup(rawScores: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const topics of Object.values(TOPIC_GROUPS)) {
    const groupMax = Math.max(0, ...topics.map((t) => rawScores[t] ?? 0))
    for (const t of topics) {
      out[t] = groupMax > 0 ? Math.min(1, Math.max(0, (rawScores[t] ?? 0) / groupMax)) : 0
    }
  }
  return out
}

// Reuse the ad-format trends from the most recent FULL refresh so a quick refresh
// doesn't overwrite real AI/web-researched format intelligence with a static
// baseline. Returns null if no full refresh has run (or the query fails), in which
// case the caller falls back to AD_FORMAT_BASELINE.
async function latestFullFormatTrends(): Promise<FormatTrend[] | null> {
  try {
    const lastFull = await prisma.trendContext.findFirst({
      where: { rawSources: { path: ['mode'], equals: 'full' } },
      orderBy: { createdAt: 'desc' },
      select: { platformFormatTrends: true },
    })
    const ft = lastFull?.platformFormatTrends as FormatTrend[] | undefined
    return ft && ft.length > 0 ? ft : null
  } catch {
    return null // JSON path filter unsupported / query failed - fall back to baseline.
  }
}

// Deterministic, no-AI analysis built purely from Google Trends data - no web
// search, no Claude, no API keys. Used by "lite" mode. `formatTrends` is carried
// over from the last full refresh (or the cold-start baseline).
function buildLiteAnalysis(
  trendData: TrendData,
  region: string,
  formatTrends: FormatTrend[] = AD_FORMAT_BASELINE,
): TrendAnalysis {
  const topicScores = relativeScoresByGroup(trendData.scores)

  // Rising / declining are derived from the same relative model used for staleness,
  // so the page and the idea scores tell one consistent story.
  const ranked = Object.entries(topicScores).sort(([, a], [, b]) => b - a)
  const rising = ranked
    .filter(([, v]) => v >= 0.6)
    .map(([topic, v]) => ({
      topic,
      rationale: `Among the hottest in its category for ${region} right now (${Math.round(v * 100)}/100 relative interest).`,
      googleTrendsScore: Math.round(v * 100),
    }))
  const declining = ranked
    .filter(([, v]) => v > 0 && v <= 0.25)
    .map(([topic, v]) => ({
      topic,
      rationale: `Cool relative to its category in ${region} (${Math.round(v * 100)}/100) - avoid leaning on this angle.`,
      googleTrendsScore: Math.round(v * 100),
    }))

  const summary =
    `Quick trend snapshot for ${region} - Google Trends only, no AI. ` +
    `Hottest right now: ${rising.slice(0, 3).map((r) => r.topic).join(', ') || 'no clear leader'}. ` +
    `Ad-format trends carry over from your last full refresh (a baseline until you run one); run a Full refresh for live web research and competitor insights.`

  return {
    summary,
    risingTopics: rising,
    decliningTopics: declining,
    // Carried over from the last full refresh, or the cold-start baseline.
    platformFormatTrends: formatTrends,
    culturalMoments: [],
    competitorAdInsights: 'Skipped in quick mode (no AI). Run a full refresh for competitor analysis.',
    topicScores,
  }
}

// India-specific web search queries - live web results via Claude search tool
const SEARCH_QUERIES = [
  // What's happening in the Indian EV market right now
  'electric vehicle trends India 2025 latest news',
  'EV adoption India consumer sentiment 2025',
  // What video/ad formats are working in India right now
  'best performing Meta ad formats India 2025',
  'trending video content formats India Instagram Reels YouTube Shorts',
  // Broader cultural moments that could connect to EV
  'trending topics India this week consumer lifestyle',
  // Competitor intelligence
  'EV charging companies India marketing campaigns 2025',
]

export async function runTrendContext(mode: TrendMode = (process.env.TREND_MODE as TrendMode) || 'full'): Promise<void> {
  try {
    const trendPlugin = getTrendData()

    // 1. Google Trends - region from TRENDS_REGION (free, no AI, no API key).
    // Pass the anchor so scores from the separate 5-keyword chunks are comparable.
    const region = process.env.TRENDS_REGION ?? 'IN'
    const trendData = await trendPlugin.fetchTrends({ topics: ALL_TOPICS, region, anchor: TRENDS_ANCHOR })

    let analysis: TrendAnalysis
    let searchResults: { title: string; snippet: string; url: string }[][] = []
    let competitorData: { summary: string; ads: { title: string; description: string; format: string }[] } = { summary: '', ads: [] }

    if (mode === 'lite') {
      // Discard a failed quick refresh: if Google Trends returned no signal
      // (all-zero / empty - typically rate-limited), don't persist anything.
      const scoreVals = Object.values(trendData.scores)
      if (scoreVals.length === 0 || scoreVals.every(s => s === 0)) {
        throw new QuickRefreshDiscardedError(
          `Quick refresh discarded: Google Trends returned no data for ${region} (likely rate-limited). Nothing was saved - try again shortly or run a Full refresh.`
        )
      }
      // No-AI mode: deterministic context from Google Trends. Ad-format trends
      // carry over from the most recent full refresh (baseline only if none has run),
      // so a quick refresh updates topic scores without erasing real format insight.
      const carriedFormats = await latestFullFormatTrends()
      analysis = buildLiteAnalysis(trendData, region, carriedFormats ?? AD_FORMAT_BASELINE)
    } else {
      // Full mode: live web search + competitor ads + Claude synthesis (uses the Anthropic key).
      const searchPlugin = getWebSearch()
      const adLibraryPlugin = getAdLibrary()

      // 2. Live web search - current news, format trends, cultural moments
      searchResults = await Promise.all(
        SEARCH_QUERIES.map((q) => searchPlugin.search(q).catch(() => []))
      )
      const searchSummary = searchResults
        .flat()
        .filter((r) => r.title && r.snippet)
        .map((r) => `[${r.title}] ${r.snippet}`)
        .join('\n')

      // 3. Competitor ad library
      competitorData = await adLibraryPlugin.fetchCompetitorAds({
        keywords: ['EV charging India', 'electric vehicle charger', 'home EV charger'],
      })

      // 4. Claude synthesizes everything into actionable trend context
      const synthesisPrompt = `You are a marketing intelligence analyst for Hopcharge, an EV charging network in India.
Your job: identify what is ACTUALLY trending right now and how Hopcharge can make ads that feel current and relevant.

## Google Trends - India (0-100 relative interest within each lens, last 90 days)
${(() => {
  // Scores are relative to the hottest topic in each lens, so they're comparable.
  const rel = relativeScoresByGroup(trendData.scores)
  const fmt = (t: string) => `${t}: ${Math.round((rel[t] ?? 0) * 100)}`
  return [
    '### EV Demand Topics',
    DEMAND_TOPICS.map(fmt).join('\n'),
    '\n### Charging Problem Topics',
    CHARGING_TOPICS.map(fmt).join('\n'),
    '\n### Lifestyle / Purchase Topics (signals Hopcharge can piggyback on)',
    LIFESTYLE_TOPICS.map(fmt).join('\n'),
    '\n### Content Format Topics (audience interest, not ad performance)',
    CONTENT_FORMAT_TOPICS.map(fmt).join('\n'),
  ].join('\n')
})()}

Rising (hottest in their lens): ${trendData.risingTopics.join(', ') || 'none detected'}
Declining (coolest in their lens): ${trendData.decliningTopics.join(', ') || 'none detected'}

## Live Web Research
${searchSummary || 'No web results available'}

## Competitor Ads
${competitorData.summary}

---
Based on ALL of the above, produce a JSON trend context:
{
  "summary": "2-3 sentence narrative - what is ACTUALLY resonating with Indian audiences right now, and what does that mean for Hopcharge's ads? Be specific: mention actual trends, formats, and cultural moments.",
  "risingTopics": [
    {"topic": "...", "rationale": "why this is relevant for Hopcharge ads right now", "googleTrendsScore": 0}
  ],
  "decliningTopics": [
    {"topic": "...", "rationale": "why avoid this angle now", "googleTrendsScore": 0}
  ],
  "platformFormatTrends": [
    {
      "format": "e.g. 15-second problem/solution reels | talking head with captions | UGC testimonial | cinematic brand film",
      "trend": "rising|stable|declining",
      "notes": "specific insight - e.g. 'fast cuts with text overlay performing 2x better than polished video in India'"
    }
  ],
  "culturalMoments": [
    {
      "moment": "e.g. cricket IPL season | monsoon travel surge | festival season",
      "relevance": "how Hopcharge can connect to this moment in an ad",
      "urgency": "now|upcoming|fading"
    }
  ],
  "competitorAdInsights": "2-3 sentences on what competitors are running and what gaps exist",
  "topicScores": {"topic": 0.0}
}

For topicScores, convert 0-100 to 0.0-1.0.
Include ALL topics from the data, not just rising ones.
Return only the JSON, no other text.`

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: synthesisPrompt }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
      analysis = extractJsonObject<TrendAnalysis>(text)
    }

    const trendContext = await prisma.trendContext.create({
      data: {
        summary: analysis.summary,
        risingTopics: analysis.risingTopics,
        decliningTopics: analysis.decliningTopics,
        platformFormatTrends: analysis.platformFormatTrends,
        competitorAdInsights: analysis.competitorAdInsights,
        topicScores: analysis.topicScores,
        rawSources: {
          googleTrends: trendData,
          webSearch: searchResults,
          competitorAds: competitorData.ads,
          culturalMoments: analysis.culturalMoments ?? [],
          mode,
        },
      },
    })

    // Re-score pending/selected ideas against new trend data.
    // Skip entirely when all topic scores are zero — this means Google Trends was
    // rate-limited and returned no signal. Demoting ideas on bad data produces
    // false-positive `idea_demoted_stale_trend` noise in Agent Actions.
    const topicScores = analysis.topicScores as Record<string, number>
    const scoreValues = Object.values(topicScores)
    const allZeroScores = scoreValues.length === 0 || scoreValues.every(v => v === 0)

    if (!allZeroScores) {
      const ideas = await prisma.idea.findMany({
        where: { status: { in: ['pending', 'selected'] } },
        select: { id: true, title: true, trendTags: true },
      })

      const now = new Date()
      // Collect every write and flush as one batched transaction rather than
      // 1-2 round trips per idea (N+1).
      const ops: Prisma.PrismaPromise<unknown>[] = []

      for (const idea of ideas) {
        if (!idea.trendTags || idea.trendTags.length === 0) continue

        const tagScores = idea.trendTags.map((tag) => {
          const normalizedTag = tag.toLowerCase().replace(/\s+/g, '_')
          return topicScores[tag] ?? topicScores[normalizedTag] ?? 0
        })
        const avgScore = tagScores.reduce((s, v) => s + v, 0) / tagScores.length

        let trendWarning: string | null = null
        if (avgScore < 0.3) {
          const lowestTag = idea.trendTags[tagScores.indexOf(Math.min(...tagScores))]
          trendWarning = `"${lowestTag}" has declined significantly (score: ${Math.round(avgScore * 100)}). Consider refreshing this idea.`
        } else if (avgScore < 0.6) {
          trendWarning = `Trend score is moderate (${Math.round(avgScore * 100)}). Monitor before investing in production.`
        }

        ops.push(
          prisma.idea.update({
            where: { id: idea.id },
            data: { trendScore: avgScore, trendScoredAt: now, trendWarning },
          })
        )

        if (avgScore < 0.3) {
          ops.push(
            prisma.agentAction.create({
              data: {
                actionType: 'idea_demoted_stale_trend',
                decisionRationale: `Idea "${idea.title}" has avg trend score ${avgScore.toFixed(2)}. Tags: ${idea.trendTags.join(', ')}`,
                relatedEntityId: idea.id,
              },
            })
          )
        }
      }

      if (ops.length > 0) await prisma.$transaction(ops)
    }

    await prisma.agentAction.create({
      data: {
        actionType: 'trend_context_updated',
        decisionRationale: `Trend context refreshed (${mode} mode, region: ${region}). Rising: ${trendData.risingTopics.slice(0, 3).join(', ')}. Declining: ${trendData.decliningTopics.slice(0, 3).join(', ')}.${allZeroScores ? ' Idea scoring skipped (rate-limited).' : ''}`,
        relatedEntityId: trendContext.id,
      },
    })
  } catch (err) {
    // Discarded quick refreshes are an expected, no-op outcome - don't log them
    // as a pipeline issue (that would be the "anything" we're told to avoid).
    if (err instanceof QuickRefreshDiscardedError) throw err

    await prisma.pipelineIssue.create({
      data: {
        severity: 'critical',
        stage: 'trend_analysis',
        description: `Trend context job failed: ${String(err)}`,
        isResolved: false,
      },
    })
    throw err
  }
}
