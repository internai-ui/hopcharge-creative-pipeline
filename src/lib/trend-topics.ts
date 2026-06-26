// Trend topic taxonomy - shared between the server-side trend job
// (src/lib/jobs/trend-context.ts) and the client trends page so both agree on
// which topics belong to which lens. This module must stay dependency-free (no
// server-only imports) so it can be imported into client components.
//
// Topics are grouped by the marketing "lens" they inform, and each lens is scored
// RELATIVE TO ITS OWN HOTTEST TOPIC (see relativeScoresByGroup). A doorstep-EV
// company will never out-search generic terms like "petrol price" in absolute
// volume, but within "what EV owners search" some topics are clearly hotter - and
// that relative signal is what tells us which ad angles feel current. All topics
// are real, India-searchable queries chosen to map onto Hopcharge ad angles.

// DEMAND - interest in EVs and the specific cars Hopcharge's customers own.
export const DEMAND_TOPICS = [
  'electric car India', 'Tata Nexon EV', 'Tata Punch EV', 'EV charging station',
]

// CHARGING - the problem Hopcharge solves: access, cost, time, range.
export const CHARGING_TOPICS = [
  'EV charging at home', 'EV charging cost', 'electric car charging time', 'EV range',
]

// LIFESTYLE / PURCHASE - cost-of-ownership and buying-intent angles to piggyback on.
export const LIFESTYLE_TOPICS = [
  'petrol price', 'electric car vs petrol', 'best electric car India', 'EV subsidy',
]

// CONTENT FORMAT - what content forms audiences consume. This is a PROXY: it
// measures search interest in the formats, not how ads in those formats perform
// (that's what AD_FORMAT_BASELINE / full-refresh web research covers). Surfaced on
// the trends page as "audience interest, not ad performance".
export const CONTENT_FORMAT_TOPICS = [
  'Instagram Reels', 'YouTube Shorts', 'AI video', 'podcast',
]

// Maps each topic to its lens so we can score relative to that lens's hottest topic.
export const TOPIC_GROUPS: Record<string, string[]> = {
  demand: DEMAND_TOPICS,
  charging: CHARGING_TOPICS,
  lifestyle: LIFESTYLE_TOPICS,
  format: CONTENT_FORMAT_TOPICS,
}

export const ALL_TOPICS = [
  ...DEMAND_TOPICS, ...CHARGING_TOPICS, ...LIFESTYLE_TOPICS, ...CONTENT_FORMAT_TOPICS,
]

// Stable, high-volume India query included in every Google Trends request so the
// 5-keyword chunks come back on a comparable scale (passed to the fetcher as the
// anchor). Kept out of ALL_TOPICS - it exists only to normalize.
export const TRENDS_ANCHOR = 'electric car'
