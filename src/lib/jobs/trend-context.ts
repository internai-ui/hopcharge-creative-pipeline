import { prisma } from '@/lib/db'
import { getTrendData, getWebSearch, getAdLibrary } from '@/lib/plugins/registry'
import { anthropic as client } from '@/lib/anthropic'
import { extractJsonObject } from '@/lib/json'

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

// Core EV/Hopcharge topics — always tracked
const EV_TOPICS = [
  'EV charging', 'electric vehicles', 'home charging', 'fast charging',
  'EV range anxiety', 'EV cost savings', 'EV fleet', 'EV lifestyle',
  'electric car India', 'Tata EV', 'charging infrastructure India',
]

// Broader lifestyle topics — Hopcharge can piggyback on these if they spike
const LIFESTYLE_TOPICS = [
  'road trips India', 'weekend travel India', 'work from home commute',
  'petrol price India', 'fuel cost India', 'sustainable living India',
  'smart home India', 'urban mobility India',
]

// Content/format topics — tells us what's performing on social
const FORMAT_TOPICS = [
  'Instagram Reels India', 'YouTube Shorts India', 'UGC ads India',
  'influencer marketing India', 'viral ads India',
]

const ALL_TOPICS = [...EV_TOPICS, ...LIFESTYLE_TOPICS, ...FORMAT_TOPICS]

// India-specific web search queries — live web results via Claude search tool
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

export async function runTrendContext(): Promise<void> {
  try {
    const trendPlugin = getTrendData()
    const searchPlugin = getWebSearch()
    const adLibraryPlugin = getAdLibrary()

    // 1. Google Trends — India region, all topic categories
    const region = process.env.TRENDS_REGION ?? 'IN'
    const trendData = await trendPlugin.fetchTrends({ topics: ALL_TOPICS, region })

    // 2. Live web search — current news, format trends, cultural moments
    const searchResults = await Promise.all(
      SEARCH_QUERIES.map((q) => searchPlugin.search(q).catch(() => []))
    )
    const searchSummary = searchResults
      .flat()
      .filter((r) => r.title && r.snippet)
      .map((r) => `[${r.title}] ${r.snippet}`)
      .join('\n')

    // 3. Competitor ad library
    const competitorData = await adLibraryPlugin.fetchCompetitorAds({
      keywords: ['EV charging India', 'electric vehicle charger', 'home EV charger'],
    })

    // 4. Claude synthesizes everything into actionable trend context
    const synthesisPrompt = `You are a marketing intelligence analyst for Hopcharge, an EV charging network in India.
Your job: identify what is ACTUALLY trending right now and how Hopcharge can make ads that feel current and relevant.

## Google Trends — India (0-100 interest scores, last 90 days)

### EV & Charging Topics
${EV_TOPICS.map(t => `${t}: ${trendData.scores[t] ?? 0}`).join('\n')}

### Lifestyle Topics (signals Hopcharge can piggyback on)
${LIFESTYLE_TOPICS.map(t => `${t}: ${trendData.scores[t] ?? 0}`).join('\n')}

### Content Format Topics
${FORMAT_TOPICS.map(t => `${t}: ${trendData.scores[t] ?? 0}`).join('\n')}

Rising (score >= 65): ${trendData.risingTopics.join(', ') || 'none detected'}
Declining (score < 35): ${trendData.decliningTopics.join(', ') || 'none detected'}

## Live Web Research
${searchSummary || 'No web results available'}

## Competitor Ads
${competitorData.summary}

---
Based on ALL of the above, produce a JSON trend context:
{
  "summary": "2-3 sentence narrative — what is ACTUALLY resonating with Indian audiences right now, and what does that mean for Hopcharge's ads? Be specific: mention actual trends, formats, and cultural moments.",
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
      "notes": "specific insight — e.g. 'fast cuts with text overlay performing 2x better than polished video in India'"
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
    const analysis = extractJsonObject<TrendAnalysis>(text)

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
        },
      },
    })

    // Re-score pending/selected ideas against new trend data
    const topicScores = analysis.topicScores as Record<string, number>
    const ideas = await prisma.idea.findMany({
      where: { status: { in: ['pending', 'selected'] } },
    })

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

      await prisma.idea.update({
        where: { id: idea.id },
        data: { trendScore: avgScore, trendScoredAt: new Date(), trendWarning },
      })

      if (avgScore < 0.3) {
        await prisma.agentAction.create({
          data: {
            actionType: 'idea_demoted_stale_trend',
            decisionRationale: `Idea "${idea.title}" has avg trend score ${avgScore.toFixed(2)}. Tags: ${idea.trendTags.join(', ')}`,
            relatedEntityId: idea.id,
          },
        })
      }
    }

    await prisma.agentAction.create({
      data: {
        actionType: 'trend_context_updated',
        decisionRationale: `Trend context refreshed (region: ${region}). Rising: ${trendData.risingTopics.slice(0, 3).join(', ')}. Declining: ${trendData.decliningTopics.slice(0, 3).join(', ')}. Re-scored ${ideas.length} ideas.`,
        relatedEntityId: trendContext.id,
      },
    })
  } catch (err) {
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
