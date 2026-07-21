import { prisma } from '@/lib/db'

// Data-driven ad-schedule recommender. Uses the real per-hour / per-weekday CPL from
// imported Meta history (HistoricalAd.hourlyBreakdown / weekdayBreakdown) to suggest a
// day-parting window that concentrates delivery in the cheapest-CPL hours and days.
//
// This is deliberately NOT an LLM guess: the strongest "when do ads perform" signal is
// the account's own cost-per-lead by time, which this reads directly. It is account-
// wide (the timing data is not segmented by funnel/angle), so it answers "when does
// this account get cheap leads", not "when does THIS creative specifically".

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// One row of a stored breakdown (see meta-historical.ts): hourly rows carry `hour`,
// weekday rows carry `day`; both carry spend/leads.
type BreakdownRow = { hour?: number; day?: number; spend?: number; leads?: number }

export interface ScheduleRecommendation {
  // Ready to drop into a Post's adSchedule (endHour is exclusive, matching the UI).
  adSchedule: { days: number[]; startHour: number; endHour: number } | null
  rationale: string
  // Per-slot CPL for display / charts (cpl = 0 means no leads in that slot).
  byHour: { hour: number; cpl: number; leads: number }[]
  byDay: { day: number; cpl: number; leads: number }[]
  sampleAds: number
  totalLeads: number
}

export async function recommendSchedule(): Promise<ScheduleRecommendation> {
  const ads = await prisma.historicalAd.findMany({
    select: { hourlyBreakdown: true, weekdayBreakdown: true },
  })

  const hourAgg = Array.from({ length: 24 }, () => ({ spend: 0, leads: 0 }))
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

  // Need enough signal to trust the split; otherwise recommend nothing.
  const MIN_LEADS = Math.max(1, Number(process.env.SCHEDULE_MIN_LEADS ?? 20))
  if (sampleAds === 0 || totalLeads < MIN_LEADS) {
    return {
      adSchedule: null,
      rationale:
        `Not enough historical lead data yet (${totalLeads} lead${totalLeads === 1 ? '' : 's'} across ` +
        `${sampleAds} ad${sampleAds === 1 ? '' : 's'} with timing data). Import more Meta history or let ads ` +
        `run, then recommend again.`,
      byHour,
      byDay,
      sampleAds,
      totalLeads,
    }
  }

  const overallCpl = totalSpend / totalLeads

  // Best contiguous hour window: among windows of 4-12h that capture >=40% of leads,
  // pick the lowest CPL. The 40% floor stops us picking a tiny cheap-but-empty window.
  let best: { start: number; endExclusive: number; cpl: number; leads: number } | null = null
  for (let len = 4; len <= 12; len++) {
    for (let start = 0; start + len <= 24; start++) {
      let spend = 0
      let leads = 0
      for (let h = start; h < start + len; h++) {
        spend += hourAgg[h].spend
        leads += hourAgg[h].leads
      }
      if (leads < totalLeads * 0.4) continue
      const cpl = leads > 0 ? spend / leads : Infinity
      if (!best || cpl < best.cpl) best = { start, endExclusive: start + len, cpl, leads }
    }
  }
  // Fallback (leads too concentrated for any window to clear 40%): the active span.
  const window = best ?? { start: 7, endExclusive: 22, cpl: overallCpl, leads: totalLeads }

  // Good days: below-average CPL with a fair share of volume (>= half an even split).
  const evenShare = totalLeads / 7
  const goodDays = byDay
    .filter((d) => d.leads >= evenShare * 0.5 && d.cpl > 0 && d.cpl <= overallCpl)
    .sort((a, b) => a.cpl - b.cpl)
    .map((d) => d.day)
  const days = goodDays.length ? goodDays.slice().sort((a, b) => a - b) : byDay.filter((d) => d.leads > 0).map((d) => d.day)

  const cheaperPct = Math.max(0, Math.round((1 - window.cpl / overallCpl) * 100))
  const rationale =
    `From ${totalLeads} leads across ${sampleAds} past ads: cheapest leads come ` +
    `${window.start}:00-${window.endExclusive}:00 (₹${Math.round(window.cpl)} CPL, ${cheaperPct}% below the ` +
    `₹${Math.round(overallCpl)} average) on ${days.map((d) => DOW[d]).join(', ')}.`

  return {
    adSchedule: { days, startHour: window.start, endHour: window.endExclusive },
    rationale,
    byHour,
    byDay,
    sampleAds,
    totalLeads,
  }
}
