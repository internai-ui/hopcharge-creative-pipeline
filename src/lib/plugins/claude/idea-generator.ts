import { anthropic as client } from '@/lib/anthropic'
import type { IdeaGeneratorPlugin, IdeaSuggestion, PerformanceContext, FunnelMode } from '../interfaces'
import type { Idea, TrendContext } from '@prisma/client'

const FUNNEL_OBJECTIVES: Record<string, (count: number) => string> = {
  mix: (count) =>
    `## Task\nGenerate ${count} ad creative ideas spanning the full marketing funnel — a deliberate mix of TOF awareness, MOF consideration, and BOF conversion ads. Vary the funnel stage across your ideas so the set covers cold audiences through to ready-to-buy customers.`,

  tof: (count) =>
    `## Task — TOP OF FUNNEL (Awareness)\nGenerate ${count} TOF awareness ads. Target: cold, brand-unaware urban professionals scrolling Instagram/YouTube who have never heard of Hopcharge. Goal: stop the scroll, spark curiosity, build brand recognition. No hard sell. No pricing. These are the first impression — make them feel something.`,

  mof: (count) =>
    `## Task — MIDDLE OF FUNNEL (Consideration)\nGenerate ${count} MOF consideration ads. Target: warm audiences who know they have an EV charging problem and are actively evaluating options — wall charger, public stations, or Hopcharge. Goal: build trust, address objections, and show why Hopcharge wins. Lean into features, proof, and differentiation.`,

  bof: (count) =>
    `## Task — BOTTOM OF FUNNEL (Conversion)\nGenerate ${count} BOF conversion ads. Target: hot retargeted audiences who have shown intent — they've watched a previous ad, visited the app, or are days away from signing up. Goal: push them over the line. Use urgency, specific pricing, offers, and hard CTAs. Every word should drive a booking or subscription signup.`,
}

const FUNNEL_ANGLE_GUIDANCE: Record<string, string> = {
  mix: 'Spread angles across all funnel stages: TOF (curiosity_gap, lifestyle, values, discovery), MOF (social_proof, education, problem_solution, convenience), BOF (pain_point, convenience with urgency). Vary CTA intensity from soft awareness to hard conversion.',

  tof: 'Use TOF angles only: curiosity_gap, lifestyle, values, discovery. Avoid pricing, feature-heavy copy, or transactional CTAs. CTAs must be soft: "Learn more", "Discover Hopcharge", "See how it works". Tone: aspirational, surprising, or entertaining.',

  mof: 'Use MOF angles: social_proof, education, problem_solution, convenience. Include real features (doorstep charging, Tata.ev partnership, RescueCharge, subscription plans), comparisons with alternatives, or how-it-works explainers. CTAs: "See how it works", "Try for free", "Compare plans".',

  bof: 'Use BOF angles: pain_point (with urgency), convenience, problem_solution. Include specific pricing (₹3.5/km, subscription tiers), first-time offers, FOMO language, and RescueCharge as the final anxiety reliever. CTAs must be direct and action-driving: "Book now", "Download the app", "Start your subscription", "Get your first charge today".',
}

export class ClaudeIdeaGenerator implements IdeaGeneratorPlugin {
  name = 'claude'

  async generateIdeas({
    count,
    nudge,
    existingIdeas = [],
    performanceContext,
    trendContext,
    funnelMode = 'mix',
  }: {
    count: number
    nudge?: string
    existingIdeas?: Idea[]
    performanceContext: PerformanceContext
    trendContext?: TrendContext
    funnelMode?: FunnelMode
  }): Promise<IdeaSuggestion[]> {
    const tc = trendContext as (TrendContext & {
      risingTopics: Array<{ topic: string; rationale: string; googleTrendsScore: number }>
      decliningTopics: Array<{ topic: string; rationale: string; googleTrendsScore: number }>
      platformFormatTrends: Array<{ format: string; trend: string; notes: string }>
      topicScores: Record<string, number>
      rawSources?: { culturalMoments?: Array<{ moment: string; relevance: string; urgency: string }> }
    }) | undefined
    const culturalMoments = tc?.rawSources?.culturalMoments ?? []

    const baselineSection = performanceContext.historicalBaseline.length > 0
      ? `## Proven Hopcharge Ads (CPL < Rs${process.env.CPL_SUCCESS_THRESHOLD ?? 100})
${performanceContext.historicalBaseline.slice(0, 3).map(ad => {
  const c = ad.concepts
  return `- "${ad.adName}" (Rs${ad.cpl.toFixed(0)}/lead): "${ad.bodyText.slice(0, 80)}..."${c ? ` | angle: ${c.angle} | tone: ${c.tone}` : ''}`
}).join('\n')}`
      : ''

    const funnelObjective = FUNNEL_OBJECTIVES[funnelMode](count)
    const funnelAngleGuidance = FUNNEL_ANGLE_GUIDANCE[funnelMode]

    const prompt = `You are a creative strategist for Hopcharge, India's first on-demand doorstep EV charging service. Hopcharge sends a branded mobile charging van directly to the customer — no home wall-box needed. The core customer is an urban EV owner in Delhi-NCR (Gurugram, Noida, Delhi) who lives in an apartment or rented property where installing a personal charger is not permitted or practical. They typically own a Tata EV (Nexon EV, Tiago EV, Punch EV, Curvv EV) and are a working professional, 25–45 years old. Key product facts: book via app up to 48 hours ahead; fast-charge at home/office/anywhere; RescueCharge emergency service for dead batteries; Tata.ev official partner; subscription plans from 6–24 months (~₹3.5/km equivalent). Ads run on Instagram Reels, YouTube Shorts, and Facebook — short-form video (15–30s) and static image formats.

${funnelObjective}

${baselineSection}

${tc ? `## Current Trend Context (India, live data)
${tc.summary ?? ''}

### Rising topics — lean into these
${(tc.risingTopics ?? []).map(t => `- ${t.topic} (score: ${t.googleTrendsScore}): ${t.rationale}`).join('\n') || 'None above threshold'}

### Declining topics — avoid these angles
${(tc.decliningTopics ?? []).map(t => `- ${t.topic}: ${t.rationale}`).join('\n') || 'None below threshold'}

### Video/ad format trends
${(tc.platformFormatTrends ?? []).map(f => `- ${f.format} [${f.trend}]: ${f.notes}`).join('\n') || 'No format data'}

${culturalMoments.length > 0 ? `### Cultural moments to piggyback on
${culturalMoments.map(m => `- ${m.moment} [${m.urgency}]: ${m.relevance}`).join('\n')}` : ''}

### Competitor landscape
${tc.competitorAdInsights ?? ''}` : '## Trend Context\nNot available — focus on the proven ad baseline above and general EV marketing principles.'}

## Pipeline Performance
Winning angles: ${performanceContext.winningPatterns.join(', ')}
Avoid: ${performanceContext.patternsToAvoid.join(', ')}
${performanceContext.topPerformers.length > 0 ? `Top ads: ${performanceContext.topPerformers.map(p => `"${p.idea.title}" (ROAS ${p.roas.toFixed(1)})`).join(', ')}` : ''}

${existingIdeas.length > 0 ? `## Existing ideas to avoid duplicating\n${existingIdeas.map(i => `- ${i.title}`).join('\n')}` : ''}

${nudge ? `## User direction\n${nudge}` : ''}

## Instructions
Generate exactly ${count} distinct ad ideas. For each idea:
1. ${funnelAngleGuidance}
2. Build on RISING topics and WINNING patterns — avoid declining trends
3. Extract trendTags (2-4 tags from the current trend context that this idea rides)
4. Explain your reasoning in the rationale field, referencing the funnel stage, performance data, and trends

Respond with a JSON array only, no other text:
[
  {
    "title": "short memorable name",
    "hook": "opening line / first 3 seconds script",
    "imageVisual": "static image description: single decisive moment, composition, subject, lighting, and mood — optimised for a 9:16 still photograph that reads instantly at thumb-scroll speed",
    "videoVisual": "video scene description: opening shot, camera movement, action sequence, and pacing — optimised for a 15-30 second 9:16 video ad with smooth cinematic motion",
    "cta": "call to action",
    "angle": "pain_point | social_proof | curiosity_gap | lifestyle | education | values | convenience | problem_solution | discovery",
    "trendTags": ["tag1", "tag2"],
    "rationale": "why this idea, referencing performance data and trends"
  }
]`

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('Claude did not return valid JSON array')

    const ideas = JSON.parse(jsonMatch[0]) as IdeaSuggestion[]
    return ideas.slice(0, count)
  }
}
