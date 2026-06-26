import { anthropic as client } from '@/lib/anthropic'
import type { IdeaGeneratorPlugin, IdeaSuggestion, PerformanceContext, FunnelMode } from '../interfaces'
import type { Idea, TrendContext } from '@prisma/client'

const FUNNEL_OBJECTIVES: Record<string, (count: number) => string> = {
  mix: (count) =>
    `## Task\nGenerate ${count} ad creative ideas spanning the full marketing funnel - a deliberate mix of TOF awareness, MOF consideration, and BOF conversion ads. Vary the funnel stage across your ideas so the set covers cold audiences through to ready-to-buy customers.`,

  tof: (count) =>
    `## Task - TOP OF FUNNEL (Awareness)\nGenerate ${count} TOF awareness ads. Target: cold, brand-unaware urban professionals scrolling Instagram/YouTube who have never heard of Hopcharge. Goal: stop the scroll, spark curiosity, build brand recognition. No hard sell. No pricing. These are the first impression - make them feel something.`,

  mof: (count) =>
    `## Task - MIDDLE OF FUNNEL (Consideration)\nGenerate ${count} MOF consideration ads. Target: warm audiences who know they have an EV charging problem and are actively evaluating options - wall charger, public stations, or Hopcharge. Goal: build trust, address objections, and show why Hopcharge wins. Lean into features, proof, and differentiation.`,

  bof: (count) =>
    `## Task - BOTTOM OF FUNNEL (Conversion)\nGenerate ${count} BOF conversion ads. Target: hot retargeted audiences who have shown intent - they've watched a previous ad, visited the app, or are days away from signing up. Goal: push them over the line. Use urgency, specific pricing, offers, and hard CTAs. Every word should drive a booking or subscription signup.`,
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

    const prompt = `You are a creative strategist for Hopcharge, India's first on-demand doorstep EV charging service. Hopcharge sends a branded mobile charging van directly to the customer - no home wall-box needed. The core customer is an urban EV owner in Delhi-NCR (Gurugram, Noida, Delhi) who lives in an apartment or rented property where installing a personal charger is not permitted or practical. They typically own a Tata EV (Nexon EV, Tiago EV, Punch EV, Curvv EV) and are a working professional, 25–45 years old. Key product facts: book via app up to 48 hours ahead; fast-charge at home/office/anywhere; RescueCharge emergency service for dead batteries; Tata.ev official partner; subscription plans from 6–24 months (~₹3.5/km equivalent). Ads run on Instagram Reels, YouTube Shorts, and Facebook - short-form video (15–30s) and static image formats.

## Hopcharge Van - Physical Description for Accurate Visuals
Primary van (use this unless the idea calls for the larger unit): compact Maruti Suzuki Eeco-style white Indian micro cargo van - white painted front cabin and lower panels, royal blue vinyl wrap covering the upper rear cargo section, bright gold/amber horizontal accent stripe running the full body length, "hopcharge™" wordmark and EV-charging icon on the blue panel, sliding side door that opens to reveal internal charging equipment, thick black rubber charging hose (~5 cm diameter, 3–4 m long) running from the van's open side port to the EV's charge socket.
Secondary van (for ideas featuring the larger fleet): white cube-shaped mobile battery box body on a light truck chassis - large rectangular white box with red border trim on all panel edges and yellow corner accent pieces, "hopcharge™" + "TATA EV" co-branding on panels, rear double doors from which a thick charging cable extends to the customer's EV. Yellow Hopcharge A-frame caution sign placed nearby.
Setting: upscale gated residential colony or premium office campus in Gurugram or Noida - paver-block or polished concrete surface, modern glass-and-steel towers, clean landscaping.
Customer character (ALWAYS use Sara - she appears in every ad as the EV owner being served): Indian woman, mid-to-late 20s, warm wheatish complexion with golden undertone, round soft face with full cheeks, large expressive almond-shaped dark brown eyes, naturally arched dark eyebrows, full lips with a warm genuine smile, long extremely thick voluminous near-black hair with natural loose waves falling to mid-back (her most distinctive feature - always specify this hair), athletic-curvy build ~165 cm, confident upright posture, minimal warm makeup, small hoop earrings. She is calm and unhurried - not looking at camera. Outfit varies with scene context (casual Western / Indian ethnic / athletic / formal - see scene). The Hopcharge van operator/technician is a separate background character and does NOT need to match Sara.

${funnelObjective}

${baselineSection}

${tc ? `## Current Trend Context (India, live data)
${tc.summary ?? ''}

### Rising topics - lean into these
${(tc.risingTopics ?? []).map(t => `- ${t.topic} (score: ${t.googleTrendsScore}): ${t.rationale}`).join('\n') || 'None above threshold'}

### Declining topics - avoid these angles
${(tc.decliningTopics ?? []).map(t => `- ${t.topic}: ${t.rationale}`).join('\n') || 'None below threshold'}

### Video/ad format trends
${(tc.platformFormatTrends ?? []).map(f => `- ${f.format} [${f.trend}]: ${f.notes}`).join('\n') || 'No format data'}

${culturalMoments.length > 0 ? `### Cultural moments to piggyback on
${culturalMoments.map(m => `- ${m.moment} [${m.urgency}]: ${m.relevance}`).join('\n')}` : ''}

### Competitor landscape
${tc.competitorAdInsights ?? ''}` : '## Trend Context\nNot available - focus on the proven ad baseline above and general EV marketing principles.'}

## Pipeline Performance
Winning angles: ${performanceContext.winningPatterns.join(', ')}
Avoid: ${performanceContext.patternsToAvoid.join(', ')}
${performanceContext.topPerformers.length > 0 ? `Top ads (lower CPL is better): ${performanceContext.topPerformers.map(p => `"${p.idea.title}" (CPL ₹${p.cpl.toFixed(0)})`).join(', ')}` : ''}

${existingIdeas.length > 0 ? `## Existing ideas to avoid duplicating\n${existingIdeas.map(i => `- ${i.title}`).join('\n')}` : ''}

${nudge ? `## User direction\n${nudge}` : ''}

## Instructions
Generate exactly ${count} distinct ad ideas. For each idea:
1. ${funnelAngleGuidance}
2. Build on RISING topics and WINNING patterns - avoid declining trends
3. Extract trendTags (2-4 tags from the current trend context that this idea rides)
4. Write the Meta ad copy: a primaryText and a headline (see field rules below)
5. Set funnelStage to TOF, MOF, or BOF based on the ad's intent (${funnelMode === 'mix' ? 'vary it across the set' : `all ${funnelMode.toUpperCase()} for this batch`})
6. Explain your reasoning in the rationale field, referencing the funnel stage, performance data, and trends

## Output format - primaryText and headline field rules
Every ad runs with a "Send WhatsApp Message" call-to-action button, so the copy must make the reader want to start a WhatsApp chat with Hopcharge - not click to a website.
- primaryText: the main ad body shown above the creative. 1-3 short sentences (max ~125 chars before the "See more" cutoff matters most). Hook in the first line, conversational Indian-English tone, no clickbait. End by nudging the reader toward messaging on WhatsApp (e.g. "Message us to book", "WhatsApp us your area"). Match the funnel stage: TOF = curiosity/awareness, MOF = proof/benefits, BOF = pricing/offer/urgency.
- headline: the short bold line beneath the creative. Max ~40 chars, punchy, benefit- or action-led (e.g. "Charging, at your doorstep", "Book your first charge").

## Output format - imageVisual field rules
Write imageVisual as a concrete image prompt a generative AI (Flux / Stable Diffusion) can execute directly. Structure: [SUBJECT - always Sara as the customer (use her full description: Indian woman mid-to-late 20s, warm wheatish skin, round face full cheeks, large dark almond eyes, full lips warm genuine smile, long extremely thick voluminous near-black wavy hair falling to mid-back, athletic-curvy 165 cm, confident posture), exact pose and expression] + [VAN - use the physical description above, specify which van] + [COMPOSITION - rule of thirds / diagonal / centred; foreground / midground / background layers] + [FROZEN MOMENT - the single decisive action] + [SETTING - specific Delhi-NCR location detail] + [LIGHTING - direction, quality, time of day] + [LENS - focal length and depth of field] + [MOOD - one adjective]. Do NOT describe text, logos, or overlays - only the visual scene.

## Output format - videoFirstFrame field rules
Write videoFirstFrame as a concrete STILL-image prompt (Flux / Stable Diffusion) for the VIDEO's opening frame - the exact frozen image the video starts on at t=0, before any motion. This is NOT the finished poster (that is imageVisual) and NOT a motion description: it is one clean static opening composition. Structure: [SUBJECT - Sara, exact pose/expression at the opening moment, use her full description] + [VAN if present - which van] + [COMPOSITION - the opening framing, e.g. wide establishing shot or CU] + [SETTING - Delhi-NCR detail] + [LIGHTING] + [LENS]. Mirror the opening beat of videoVisual but phrase it as a still: no verbs of motion, no camera moves, no on-screen text. Minimum 50 words.

## Output format - videoVisual field rules
Write videoVisual as a shot-by-shot description a video AI (Kling / Runway / Veo) can execute. The customer character is always Sara (Indian woman mid-to-late 20s, warm wheatish skin, round face full cheeks, large dark almond eyes, long extremely thick voluminous near-black wavy hair to mid-back, athletic-curvy build). Structure: [OPENING SHOT 0-3s - hook frame: camera type + Sara + composition] → [INCITING MOMENT 3-8s - problem or trigger: camera movement] → [RESOLUTION 8-20s - van arrives / cable connects / EV charges: include van physical description, Sara's action, camera move] → [PAYOFF 20-27s - Sara calm/relieved, EV charged indicator lit: camera pulls back or cuts wide] → [CLOSING FRAME 27-30s - van + EV parked, golden-hour glow, static beauty shot]. Use specific camera vocabulary: WES (wide establishing shot), MS (medium shot), CU (close-up), ECU (extreme close-up), OTS (over-the-shoulder), slow tracking, crane rise, dolly push/pull. Be concrete - no abstract moods, only physical actions and camera moves.

Respond with a JSON array only, no other text:
[
  {
    "title": "short memorable name",
    "hook": "opening line / first 3 seconds script - specific spoken or on-screen words",
    "imageVisual": "follow the imageVisual field rules above - minimum 60 words of concrete visual detail",
    "videoFirstFrame": "follow the videoFirstFrame field rules above - a clean still opening frame, minimum 50 words",
    "videoVisual": "follow the videoVisual field rules above - minimum 80 words covering all 5 shot beats",
    "cta": "the in-creative call to action line",
    "primaryText": "follow the primaryText field rules above - WhatsApp-led ad body",
    "headline": "follow the headline field rules above - short bold line, max ~40 chars",
    "angle": "pain_point | social_proof | curiosity_gap | lifestyle | education | values | convenience | problem_solution | discovery",
    "funnelStage": "TOF | MOF | BOF",
    "trendTags": ["tag1", "tag2"],
    "rationale": "why this idea, referencing performance data and trends"
  }
]`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('Claude did not return valid JSON array')

    const ideas = JSON.parse(jsonMatch[0]) as IdeaSuggestion[]
    return ideas.slice(0, count)
  }
}
