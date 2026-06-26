import { prisma } from '@/lib/db'
import { PerformanceClient } from '@/components/performance/PerformanceClient'
import type { HourlyRow, WeekdayRow } from '@/lib/meta-historical'

export default async function PerformancePage() {
  const [snapshots, historicalAds] = await Promise.all([
    // Load all snapshots; the client filters by the selected range (incl. All time).
    prisma.performanceSnapshot.findMany({
      include: { post: { include: { creative: { include: { idea: true } } } } },
      orderBy: { snapshotDate: 'asc' },
    }),
    prisma.historicalAd.findMany({
      orderBy: { cpl: 'asc' },
      select: {
        id: true, metaAdId: true, adName: true, campaignName: true,
        cpl: true, leads: true, spend: true, impressions: true, reach: true,
        clicks: true, cpm: true, ctr: true, isSuccessful: true,
        dateFrom: true, dateTo: true,
        hourlyBreakdown: true, weekdayBreakdown: true,
      },
    }),
  ])

  // Aggregate timing breakdowns across all ads that have the data
  const hourlyAgg = Array.from({ length: 24 }, (_, i) => ({
    hour: i, leads: 0, spend: 0, cplSum: 0, count: 0,
  }))
  const weekdayAgg = Array.from({ length: 7 }, (_, d) => ({
    day: d, leads: 0, spend: 0, cplSum: 0, count: 0,
  }))

  for (const ad of historicalAds) {
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

  const hasTimingData = historicalAds.some(a => a.hourlyBreakdown != null)

  const hourlyTimingData = hourlyAgg.map(r => ({
    hour: r.hour,
    label: `${r.hour}:00`,
    leads: r.leads,
    spend: Math.round(r.spend),
    cpl: r.count > 0 ? Math.round(r.cplSum / r.count) : 0,
  }))

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const weekdayTimingData = weekdayAgg.map(r => ({
    day: r.day,
    label: DAY_NAMES[r.day],
    leads: r.leads,
    spend: Math.round(r.spend),
    cpl: r.count > 0 ? Math.round(r.cplSum / r.count) : 0,
  }))

  // Keep timing breakdowns - client uses them for per-ad drilldown rows
  // Cast Json fields to the expected types; they're stored with the right shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const historicalAdsForClient = historicalAds as any[]

  return (
    <PerformanceClient
      initialSnapshots={snapshots}
      initialHistoricalAds={historicalAdsForClient}
      hourlyTimingData={hourlyTimingData}
      weekdayTimingData={weekdayTimingData}
      hasTimingData={hasTimingData}
    />
  )
}
