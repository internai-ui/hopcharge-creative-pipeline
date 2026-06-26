import { prisma } from '@/lib/db'
import type { HourlyRow, WeekdayRow } from '@/lib/meta-historical'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Aggregated hourly + day-of-week timing across all imported Meta ads. Mirrors
// the aggregation in the performance page so the client can refetch after a sync
// without a full reload.
export async function GET() {
  try {
    const ads = await prisma.historicalAd.findMany({
      select: { hourlyBreakdown: true, weekdayBreakdown: true },
    })

    const hourlyAgg = Array.from({ length: 24 }, (_, i) => ({ hour: i, leads: 0, spend: 0, cplSum: 0, count: 0 }))
    const weekdayAgg = Array.from({ length: 7 }, (_, d) => ({ day: d, leads: 0, spend: 0, cplSum: 0, count: 0 }))

    for (const ad of ads) {
      const hourly = ad.hourlyBreakdown as HourlyRow[] | null
      if (hourly) {
        for (const row of hourly) {
          if (row.hour < 0 || row.hour > 23) continue
          hourlyAgg[row.hour].leads += row.leads
          hourlyAgg[row.hour].spend += row.spend
          if (row.cpl > 0) { hourlyAgg[row.hour].cplSum += row.cpl; hourlyAgg[row.hour].count++ }
        }
      }
      const weekday = ad.weekdayBreakdown as WeekdayRow[] | null
      if (weekday) {
        for (const row of weekday) {
          if (row.day < 0 || row.day > 6) continue
          weekdayAgg[row.day].leads += row.leads
          weekdayAgg[row.day].spend += row.spend
          if (row.cpl > 0) { weekdayAgg[row.day].cplSum += row.cpl; weekdayAgg[row.day].count++ }
        }
      }
    }

    const hourly = hourlyAgg.map(r => ({
      hour: r.hour, label: `${r.hour}:00`, leads: r.leads,
      spend: Math.round(r.spend), cpl: r.count > 0 ? Math.round(r.cplSum / r.count) : 0,
    }))
    const weekday = weekdayAgg.map(r => ({
      day: r.day, label: DAY_NAMES[r.day], leads: r.leads,
      spend: Math.round(r.spend), cpl: r.count > 0 ? Math.round(r.cplSum / r.count) : 0,
    }))
    const hasTimingData = ads.some(a => a.hourlyBreakdown != null)

    return Response.json({ hourly, weekday, hasTimingData })
  } catch (err) {
    return Response.json({ error: 'Failed to fetch timing data', details: String(err) }, { status: 500 })
  }
}
