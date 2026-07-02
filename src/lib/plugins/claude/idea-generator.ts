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
Settings (these are EXAMPLES, not a default to repeat every time - vary widely, see the visual diversity mandate): upscale gated residential colony, premium office campus, rooftop/stilt parking, a Noida or Gurugram street, an expressway or highway, a leafy residential lane, a mall drop-off - all across Delhi-NCR. Vary surface, weather, and time of day from ad to ad; do NOT default every idea to a paver-block Gurugram driveway with glass towers behind.
Recurring customer character - Sara: use her ONLY when an ad actually features the EV owner / customer. NOT every ad needs a person. Her description: Indian woman, mid-to-late 20s, warm wheatish complexion with golden undertone, round soft face with full cheeks, large expressive almond-shaped dark brown eyes, naturally arched dark eyebrows, full lips with a warm genuine smile, long extremely thick voluminous near-black hair with natural loose waves falling to mid-back (her most distinctive feature - always specify this hair when she appears), athletic-curvy build ~165 cm, confident upright posture, minimal warm makeup, small hoop earrings. She is calm and unhurried - not looking at camera. Outfit varies with scene context (casual Western / Indian ethnic / athletic / formal - see scene).
Consistency rule: WHENEVER an ad shows the EV owner / customer, it MUST be Sara - she is the single recognisable brand face, so customers never vary. But many strong ads have NO customer at all: product/van hero shots, the EV charging alone, a macro detail of the connector or charge port, an aerial or cityscape, an infographic-style frame, a lifestyle scene implied without a person. Use those freely to break the monotony. Any OTHER humans (van technician/operator, family members, passers-by, other EV owners in a social-proof montage) are NOT Sara and SHOULD genuinely vary in age, gender, and appearance.

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
7. Make this idea's VISUAL genuinely distinct from the others in this batch - see the visual diversity mandate below

## Visual diversity mandate (critical - read before writing imageVisual / videoFirstFrame / videoVisual)
Past batches all looked like the same photograph: the same woman beside the same van on the same paver-block Gurugram driveway in the same golden-hour light at 50 mm. Do NOT repeat that. Across these ${count} ideas, deliberately spread the visuals so no two creatives read as the same shot. Vary the following idea-to-idea (treat them as dials to turn, not boxes to leave at default):
- SUBJECT: Sara (the customer) in some, but also van-only hero shots, the EV charging alone, macro connector/charge-port detail, the technician at work, a skyline/cityscape, an overhead flat-lay, or an infographic-style frame.
- LOCATION: rotate across Delhi-NCR - gated colony, rooftop/stilt/basement parking, office-tower forecourt, a Noida market street, DLF CyberHub, an expressway, a leafy lane, a mall drop-off, monsoon-wet tarmac. Avoid reusing the same location twice in one batch.
- TIME OF DAY & LIGHTING: golden hour is only ONE option - also bright midday, blue-hour dusk, night with practical/street lights, overcast soft light, harsh directional sun, warm indoor/garage light, neon night.
- SHOT TYPE & LENS: mix wide-establishing, medium, close-up, extreme macro, overhead/drone, low-angle hero - with focal lengths to match, not always 50 mm shallow depth of field.
- COMPOSITION & MOOD: vary framing (rule-of-thirds, centred, diagonal, flat-lay, ECU) and emotional register (urgent, serene, aspirational, playful, premium, reassuring).
This visual variety must NOT override strategy: each idea's angle, funnel stage, copy, and trendTags must still be driven by the RISING topics, WINNING patterns, and proven baseline above. Vary the LOOK; keep the SUBSTANCE grounded in the trend and performance data.

## Output format - primaryText and headline field rules
Every ad runs with a "Send WhatsApp Message" call-to-action button, so the copy must make the reader want to start a WhatsApp chat with Hopcharge - not click to a website.
- primaryText: the main ad body shown above the creative. 1-3 short sentences (max ~125 chars before the "See more" cutoff matters most). Hook in the first line, conversational Indian-English tone, no clickbait. End by nudging the reader toward messaging on WhatsApp (e.g. "Message us to book", "WhatsApp us your area"). Match the funnel stage: TOF = curiosity/awareness, MOF = proof/benefits, BOF = pricing/offer/urgency.
- headline: the short bold line beneath the creative. Max ~40 chars, punchy, benefit- or action-led (e.g. "Charging, at your doorstep", "Book your first charge").

## Output format - imageVisual field rules
Write imageVisual as a concrete image prompt a generative AI (Flux / Stable Diffusion) can execute directly. Structure: [SUBJECT - what the frame is actually about: if a customer is present it is Sara (use her full description: Indian woman mid-to-late 20s, warm wheatish skin, round face full cheeks, large dark almond eyes, full lips warm genuine smile, long extremely thick voluminous near-black wavy hair falling to mid-back, athletic-curvy 165 cm, confident posture) with exact pose and expression - OR, for a no-customer ad, the van, the EV charging alone, a macro connector/charge-port detail, the technician, a cityscape, or an infographic scene] + [VAN - if in frame, use the physical description above and specify which van] + [COMPOSITION - choose and vary: rule of thirds / centred / diagonal / overhead flat-lay / extreme close-up / wide establishing; name foreground / midground / background layers] + [FROZEN MOMENT - the single decisive action] + [SETTING - a SPECIFIC Delhi-NCR location, deliberately different from the other ideas in this batch] + [LIGHTING - direction, quality, and TIME OF DAY - vary across the batch, not always golden hour] + [LENS - focal length and depth of field - vary the shot type, not always 50 mm] + [MOOD - one adjective]. Do NOT describe text, logos, or overlays - only the visual scene.

## Output format - videoFirstFrame field rules
Write videoFirstFrame as a concrete STILL-image prompt (Flux / Stable Diffusion) for the VIDEO's opening frame - the exact frozen image the video starts on at t=0, before any motion. This is NOT the finished poster (that is imageVisual) and NOT a motion description: it is one clean static opening composition. Structure: [SUBJECT - if the opening frame shows the customer it is Sara (use her full description, exact pose/expression at the opening moment); otherwise the van, the EV, a detail, or an establishing location] + [VAN if present - which van] + [COMPOSITION - the opening framing, e.g. wide establishing shot or CU] + [SETTING - Delhi-NCR detail, varied across the batch] + [LIGHTING - include time of day, not always golden hour] + [LENS]. Mirror the opening beat of videoVisual but phrase it as a still: no verbs of motion, no camera moves, no on-screen text. Minimum 50 words.

## Output format - videoVisual field rules
Write videoVisual as a shot-by-shot description a video AI (Kling / Runway / Veo) can execute. If the spot features the customer, that character is Sara (Indian woman mid-to-late 20s, warm wheatish skin, round face full cheeks, large dark almond eyes, long extremely thick voluminous near-black wavy hair to mid-back, athletic-curvy build) - but not every spot needs her; some can be product/van-led, detail-led, or city/lifestyle montages, and any other people (technician, bystanders, other owners) are not Sara and may vary. Structure: [OPENING SHOT 0-3s - hook frame: camera type + subject (Sara if a customer is shown) + composition] → [INCITING MOMENT 3-8s - problem or trigger: camera movement] → [RESOLUTION 8-20s - van arrives / cable connects / EV charges: include van physical description, the subject's action, camera move] → [PAYOFF 20-27s - subject calm/relieved (Sara if present), EV charged indicator lit: camera pulls back or cuts wide] → [CLOSING FRAME 27-30s - van + EV parked, static beauty shot - vary the light and time of day across the batch, not always golden hour]. Use specific camera vocabulary: WES (wide establishing shot), MS (medium shot), CU (close-up), ECU (extreme close-up), OTS (over-the-shoulder), slow tracking, crane rise, dolly push/pull. Be concrete - no abstract moods, only physical actions and camera moves.

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
