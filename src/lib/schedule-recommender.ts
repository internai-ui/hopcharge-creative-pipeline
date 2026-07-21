import { prisma } from '@/lib/db'

// Data-driven ad-schedule recommender. Two signals, blended:
//   1. The account's real per-hour / per-weekday CPL from imported Meta history
//      (HistoricalAd.hourlyBreakdown / weekdayBreakdown) - "when does this account get
//      cheap leads?".
//   2. A keyword daypart heuristic on the ad's own copy - "does THIS ad read as a
//      night / morning / workday message?" - so a nighttime-convenience ad leans
//      evening and a workday-charging ad leans midday.
//
// No LLM: (1) is arithmetic, (2) is a rule-based keyword scan. Content sets the
// daypart; the CPL data refines the exact hours within it. When there's no timing
// data yet, the content heuristic drives the recommendation on its own.

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type BreakdownRow = { hour?: number; day?: number; spend?: number; leads?: number }

// ── Content daypart heuristic ─────────────────────────────────────────────────
// A single contiguous [startHour, endHour) window can't wrap midnight, so "night"
// is treated as the evening block (18:00-24:00).
interface Daypart {
  key: string
  label: string
  startHour: number
  endHour: number
  keywords: RegExp[]
}

const DAYPARTS: Daypart[] = [
  {
    key: 'evening',
    label: 'evening / night',
    startHour: 18,
    endHour: 24,
    keywords: [
      /\bnight(s|time|-time)?\b/, /\bovernight\b/, /\bevening(s)?\b/, /\bdusk\b/, /\bsundown\b/,
      /\bafter[- ]?work\b/, /\bafter hours\b/, /\bdinner\b/, /\bbedtime\b/, /\bwhile you sleep\b/,
      /\bas you sleep\b/, /\bwhile (you're|you are) asleep\b/, /\blate(-| )?night\b/, /\bnightly\b/,
      /\bwind[- ]?down\b/, /\bend of (the )?day\b/, /\bhome for the (night|evening)\b/, /\bcharge (it )?overnight\b/,
    ],
  },
  {
    key: 'morning',
    label: 'morning',
    startHour: 6,
    endHour: 11,
    keywords: [
      /\bmorning(s)?\b/, /\bsunrise\b/, /\bdawn\b/, /\bbreakfast\b/, /\bearly[- ](bird|start|riser|morning)\b/,
      /\bbefore work\b/, /\bstart (of |your |the )?day\b/, /\bkick[- ]?start\b/, /\bschool run\b/, /\bmorning commute\b/,
    ],
  },
  {
    key: 'midday',
    label: 'midday / work hours',
    startHour: 10,
    endHour: 16,
    keywords: [
      /\blunch(time|-hour| hour|es|-break| break)?\b/, /\bmidday\b/, /\bnoon\b/, /\bwork[- ]?day\b/,
      /\bat (the )?office\b/, /\boffice hours\b/, /\bat work\b/, /\bwhile you work\b/, /\bduring (the )?work(day| hours)\b/,
      /\bduring the day\b/, /\bday[- ]?time\b/, /\bafternoon(s)?\b/, /\bworkplace\b/, /\b9[ -](to|-)[ -]?5\b/,
      /\bparked at (the )?(office|work)\b/, /\bcoffee break\b/, /\bmeeting(s)?\b/,
    ],
  },
]

export interface DaypartMatch {
  key: string
  label: string
  startHour: number
  endHour: number
  matched: string[]
}

// Scan ad copy for time-of-day cues. Returns the best-matching daypart, or null when
// there's no clear signal (or a tie).
export function detectDaypart(text: string): DaypartMatch | null {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return null

  const scored = DAYPARTS.map((dp) => {
    const matched: string[] = []
    for (const re of dp.keywords) {
      const m = t.match(re)
      if (m) matched.push(m[0].trim())
    }
    return { dp, matched }
  }).filter((s) => s.matched.length > 0)

  if (scored.length === 0) return null
  scored.sort((a, b) => b.matched.length - a.matched.length)
  // Ambiguous (top two tied) → no confident bias.
  if (scored.length > 1 && scored[1].matched.length === scored[0].matched.length) return null

  const { dp, matched } = scored[0]
  return { key: dp.key, label: dp.label, startHour: dp.startHour, endHour: dp.endHour, matched: [...new Set(matched)] }
}

// ── CPL window search ─────────────────────────────────────────────────────────
type HourAgg = { spend: number; leads: number }[]

// Best contiguous 4-12h window by CPL, capturing >=40% of leads. When `bias` is given,
// only windows overlapping that daypart are considered. Returns null if none qualify.
function bestWindow(
  hourAgg: HourAgg,
  totalLeads: number,
  bias: { start: number; endEx: number } | null,
): { start: number; endEx: number; cpl: number } | null {
  let best: { start: number; endEx: number; cpl: number } | null = null
  for (let len = 4; len <= 12; len++) {
    for (let start = 0; start + len <= 24; start++) {
      const endEx = start + len
      if (bias && !(start < bias.endEx && endEx > bias.start)) continue // must overlap the daypart
      let spend = 0
      let leads = 0
      for (let h = start; h < endEx; h++) {
        spend += hourAgg[h].spend
        leads += hourAgg[h].leads
      }
      if (leads < totalLeads * 0.4) continue
      const cpl = leads > 0 ? spend / leads : Infinity
      if (!best || cpl < best.cpl) best = { start, endEx, cpl }
    }
  }
  return best
}

export interface ScheduleRecommendation {
  adSchedule: { days: number[]; startHour: number; endHour: number } | null
  rationale: string
  daypart: DaypartMatch | null
  byHour: { hour: number; cpl: number; leads: number }[]
  byDay: { day: number; cpl: number; leads: number }[]
  sampleAds: number
  totalLeads: number
}

export async function recommendSchedule(opts?: { adText?: string }): Promise<ScheduleRecommendation> {
  const daypart = opts?.adText ? detectDaypart(opts.adText) : null

  const ads = await prisma.historicalAd.findMany({
    select: { hourlyBreakdown: true, weekdayBreakdown: true },
  })

  const hourAgg: HourAgg = Array.from({ length: 24 }, () => ({ spend: 0, leads: 0 }))
  const dayAgg = Array.from({ length: 7 }, () => ({ spend: 0, leads: 0 }))
  let sampleAds = 0

  for (const ad of ads) {
    const hourly = ad.hourlyBreakdown as BreakdownRow[] | null
    const weekday = ad.weekdayBreakdown as BreakdownRow[] | null
    let contributed = false
    if (Array.isArray(hourly)) {
      for (const r of hourly) {
        if (typeof r.hour === 'number' && r.hour >= 0 && r.hour < 24) {
          hourAgg[r.hour].spend += Number(r.spend ?? 0)
          hourAgg[r.hour].leads += Number(r.leads ?? 0)
          contributed = true
        }
      }
    }
    if (Array.isArray(weekday)) {
      for (const r of weekday) {
        if (typeof r.day === 'number' && r.day >= 0 && r.day < 7) {
          dayAgg[r.day].spend += Number(r.spend ?? 0)
          dayAgg[r.day].leads += Number(r.leads ?? 0)
        }
      }
    }
    if (contributed) sampleAds++
  }

  const byHour = hourAgg.map((h, i) => ({ hour: i, leads: h.leads, cpl: h.leads > 0 ? h.spend / h.leads : 0 }))
  const byDay = dayAgg.map((d, i) => ({ day: i, leads: d.leads, cpl: d.leads > 0 ? d.spend / d.leads : 0 }))
  const totalLeads = hourAgg.reduce((n, h) => n + h.leads, 0)
  const totalSpend = hourAgg.reduce((n, h) => n + h.spend, 0)

  const MIN_LEADS = Math.max(1, Number(process.env.SCHEDULE_MIN_LEADS ?? 20))
  const dataSufficient = sampleAds > 0 && totalLeads >= MIN_LEADS
  const overallCpl = dataSufficient ? totalSpend / totalLeads : 0

  // Days: below-average-CPL days with a fair share of volume (only when data exists).
  const evenShare = totalLeads / 7
  const goodDays = byDay
    .filter((d) => d.leads >= evenShare * 0.5 && d.cpl > 0 && d.cpl <= overallCpl)
    .map((d) => d.day)
  const daysWithData = byDay.filter((d) => d.leads > 0).map((d) => d.day)
  const days = dataSufficient ? (goodDays.length ? goodDays.slice().sort((a, b) => a - b) : daysWithData) : [0, 1, 2, 3, 4, 5, 6]

  // Hour window: CPL-driven, biased to the ad's daypart when we have one.
  const window = dataSufficient
    ? bestWindow(hourAgg, totalLeads, daypart ? { start: daypart.startHour, endEx: daypart.endHour } : null)
    : null

  const themeStr = daypart ? `${daypart.label} (${daypart.matched.join(', ')})` : ''

  // 1. CPL window refined within the ad's daypart.
  if (window && daypart) {
    const cheaper = Math.max(0, Math.round((1 - window.cpl / overallCpl) * 100))
    return {
      adSchedule: { days, startHour: window.start, endHour: window.endEx },
      rationale:
        `This ad reads as ${themeStr}; within that, cheapest leads run ${window.start}:00-${window.endEx}:00 ` +
        `(₹${Math.round(window.cpl)} CPL, ${cheaper}% below the ₹${Math.round(overallCpl)} average) on ${days.map((d) => DOW[d]).join(', ')}.`,
      daypart, byHour, byDay, sampleAds, totalLeads,
    }
  }

  // 2. Account-wide CPL window (no content signal).
  if (window) {
    const cheaper = Math.max(0, Math.round((1 - window.cpl / overallCpl) * 100))
    return {
      adSchedule: { days, startHour: window.start, endHour: window.endEx },
      rationale:
        `From ${totalLeads} leads across ${sampleAds} past ads: cheapest leads come ${window.start}:00-${window.endEx}:00 ` +
        `(₹${Math.round(window.cpl)} CPL, ${cheaper}% below the ₹${Math.round(overallCpl)} average) on ${days.map((d) => DOW[d]).join(', ')}.`,
      daypart, byHour, byDay, sampleAds, totalLeads,
    }
  }

  // 3. No usable CPL data, but the ad's copy implies a daypart - content-only prior.
  if (daypart) {
    return {
      adSchedule: { days, startHour: daypart.startHour, endHour: daypart.endHour },
      rationale:
        `No historical timing data yet, so this is from the ad's content: it reads as ${themeStr}, so run it ` +
        `${daypart.startHour}:00-${daypart.endHour}:00. It'll refine within that window once real CPL-by-hour data comes in.`,
      daypart, byHour, byDay, sampleAds, totalLeads,
    }
  }

  // 4. Nothing to go on.
  return {
    adSchedule: null,
    rationale:
      `Not enough historical lead data (${totalLeads} lead${totalLeads === 1 ? '' : 's'} across ${sampleAds} ad${sampleAds === 1 ? '' : 's'}), ` +
      `and no clear time-of-day cue in this ad's copy. Import more Meta history or add a time reference to the copy, then recommend again.`,
    daypart: null, byHour, byDay, sampleAds, totalLeads,
  }
}
