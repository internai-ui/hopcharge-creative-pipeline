'use client'

import { useState, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import type { PerformanceSnapshot, Post, Creative, Idea } from '@prisma/client'

type SnapshotWithRelations = PerformanceSnapshot & {
  post: Post & { creative: Creative & { idea: Idea } }
}

type HRow = { hour: number; leads: number; spend: number; cpl: number }
type WRow = { day: number; leads: number; spend: number; cpl: number }

type ImportedAd = {
  id: string
  metaAdId: string
  adName: string
  campaignName: string | null
  cpl: number
  leads: number
  spend: number
  impressions: number | null
  reach: number | null
  clicks: number | null
  cpm: number | null
  ctr: number | null
  isSuccessful: boolean
  dateFrom: string | Date
  dateTo: string | Date
  hourlyBreakdown?: HRow[] | null
  weekdayBreakdown?: WRow[] | null
}

type TimingRow = { label: string; leads: number; spend: number; cpl: number }

interface PerformanceClientProps {
  initialSnapshots: SnapshotWithRelations[]
  initialHistoricalAds: ImportedAd[]
  hourlyTimingData: (TimingRow & { hour: number })[]
  weekdayTimingData: (TimingRow & { day: number })[]
  hasTimingData: boolean
}

type SortKey = 'impressions' | 'reach' | 'clicks' | 'spend' | 'cpm' | 'ctr' | 'freq' | 'cpl'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

// Business thresholds for cost-per-lead (₹). Lower is better.
const CPL_GOOD = 100
const CPL_OK = 150

// Meta returns all monetary values in the ad account's currency. Hopcharge B2C
// is an INR account, so every spend/CPM/CPL figure is shown in ₹ (en-IN grouping).
const inr = (n: number, dp = 0) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`

// Compact large counts (reach/impressions) using Indian lakh/crore grouping.
const compact = (n: number) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

// Date-range options for the performance filter. 'all' = all time (no window).
const RANGE_OPTIONS: [string, string][] = [['7d', '7d'], ['30d', '30d'], ['90d', '90d'], ['all', 'All time']]

// Lower bound for a selected range. 'all' returns the epoch so nothing is filtered out.
function rangeCutoff(range: string): Date {
  if (range === 'all') return new Date(0)
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

// Average CPL across snapshots, ignoring days with no lead data.
function avgCplOf(snaps: { cpl: SnapshotWithRelations['cpl'] }[]): number {
  const vals = snaps
    .map((s) => (s.cpl != null ? Number(s.cpl) : null))
    .filter((v): v is number => v != null && v > 0)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
}

function ChevronUp() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

export function PerformanceClient({ initialSnapshots, initialHistoricalAds, hourlyTimingData, weekdayTimingData, hasTimingData }: PerformanceClientProps) {
  const [snapshots, setSnapshots] = useState<SnapshotWithRelations[]>(initialSnapshots)
  const [dateRange, setDateRange] = useState('all')
  const [platform, setPlatform] = useState<'all' | 'meta' | 'youtube'>('all')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [timingHourly, setTimingHourly] = useState(hourlyTimingData)
  const [timingWeekday, setTimingWeekday] = useState(weekdayTimingData)
  const [timingDataAvailable, setTimingDataAvailable] = useState(hasTimingData)
  const [expandedPost, setExpandedPost] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('cpl')
  const [sortAsc, setSortAsc] = useState(true) // lower CPL first

  const filteredSnapshots = useMemo(() => {
    const cutoff = rangeCutoff(dateRange)
    return snapshots.filter((s) =>
      new Date(s.snapshotDate) >= cutoff &&
      (platform === 'all' || s.post.platform === platform)
    )
  }, [snapshots, dateRange, platform])

  // Historical ads filtered by selected date range (dateTo must fall within the window)
  const filteredHistoricalAds = useMemo(() => {
    const cutoff = rangeCutoff(dateRange)
    return initialHistoricalAds.filter(a => new Date(a.dateTo) >= cutoff)
  }, [initialHistoricalAds, dateRange])

  const summary = useMemo(() => {
    const includeImported = platform !== 'youtube'
    const imp = includeImported ? filteredHistoricalAds : []
    const sum = (ns: (number | null)[]) => ns.reduce((s: number, v) => s + (v ?? 0), 0)

    const totalSpend = filteredSnapshots.reduce((s, snap) => s + Number(snap.spend), 0) + sum(imp.map((a) => a.spend))
    const totalLeads = filteredSnapshots.reduce((s, snap) => s + (snap.leads ?? 0), 0) + sum(imp.map((a) => a.leads))
    const totalReach = filteredSnapshots.reduce((s, snap) => s + snap.reach, 0) + sum(imp.map((a) => a.reach))
    const totalImpr = filteredSnapshots.reduce((s, snap) => s + snap.impressions, 0) + sum(imp.map((a) => a.impressions))
    const totalClicks = filteredSnapshots.reduce((s, snap) => s + snap.clicks, 0) + sum(imp.map((a) => a.clicks))

    return {
      totalSpend,
      totalReach,
      avgCpl: totalLeads > 0 ? totalSpend / totalLeads : 0, // blended: spend ÷ leads
      avgCpm: totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : 0, // blended: spend ÷ impressions × 1000
      avgCtr: totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0, // blended: clicks ÷ impressions
    }
  }, [filteredSnapshots, platform, filteredHistoricalAds])

  const byCreative = useMemo(() => {
    const map = new Map<string, { idea: Idea; snapshots: SnapshotWithRelations[] }>()
    for (const snap of filteredSnapshots) {
      const key = snap.post.creative.idea.id
      if (!map.has(key)) map.set(key, { idea: snap.post.creative.idea, snapshots: [] })
      map.get(key)!.snapshots.push(snap)
    }
    return Array.from(map.entries()).map(([, v]) => v)
  }, [filteredSnapshots])

  const sortedCreatives = useMemo(() => {
    return [...byCreative].sort((a, b) => {
      const getTotals = (c: typeof a) => ({
        impressions: c.snapshots.reduce((s, snap) => s + snap.impressions, 0),
        reach: c.snapshots.reduce((s, snap) => s + snap.reach, 0),
        clicks: c.snapshots.reduce((s, snap) => s + snap.clicks, 0),
        spend: c.snapshots.reduce((s, snap) => s + Number(snap.spend), 0),
        cpm: c.snapshots.reduce((s, snap) => s + Number(snap.cpm), 0) / c.snapshots.length,
        ctr: c.snapshots.reduce((s, snap) => s + Number(snap.ctr), 0) / c.snapshots.length * 100,
        freq: c.snapshots.reduce((s, snap) => s + Number(snap.frequency), 0) / c.snapshots.length,
        cpl: avgCplOf(c.snapshots),
      })
      const aVal = getTotals(a)[sortKey]
      const bVal = getTotals(b)[sortKey]
      return sortAsc ? aVal - bVal : bVal - aVal
    })
  }, [byCreative, sortKey, sortAsc])

  const cplChartData = useMemo(() => {
    // Best (lowest-CPL) 5 creatives.
    const top5 = [...byCreative]
      .sort((a, b) => avgCplOf(a.snapshots) - avgCplOf(b.snapshots))
      .slice(0, 5)
    const allDates = [...new Set(filteredSnapshots.map((s) => new Date(s.snapshotDate).toISOString().split('T')[0]))].sort()
    return allDates.map((date) => {
      const point: Record<string, unknown> = { date }
      for (const creative of top5) {
        const snap = creative.snapshots.find(
          (s) => new Date(s.snapshotDate).toISOString().split('T')[0] === date
        )
        if (snap && snap.cpl != null) point[creative.idea.title.slice(0, 20)] = Number(snap.cpl)
      }
      return point
    })
  }, [filteredSnapshots, byCreative])

  const spendData = useMemo(() => {
    return byCreative.map((c) => ({
      name: c.idea.title.slice(0, 15),
      spend: c.snapshots.reduce((s, snap) => s + Number(snap.spend), 0),
      impressions: c.snapshots.reduce((s, snap) => s + snap.impressions, 0) / 1000,
    }))
  }, [byCreative])

  const importedSummary = useMemo(() => {
    if (filteredHistoricalAds.length === 0) return { count: 0, totalSpend: 0, avgCpl: 0 }
    const totalSpend = filteredHistoricalAds.reduce((s, a) => s + a.spend, 0)
    const totalLeads = filteredHistoricalAds.reduce((s, a) => s + a.leads, 0)
    return { count: filteredHistoricalAds.length, totalSpend, avgCpl: totalLeads > 0 ? totalSpend / totalLeads : 0 }
  }, [filteredHistoricalAds])

  const importedMonthly = useMemo(() => {
    if (platform === 'youtube') return []
    const map = new Map<string, { spend: number; leads: number; reach: number }>()
    for (const a of filteredHistoricalAds) {
      const d = new Date(a.dateTo)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const cur = map.get(key) ?? { spend: 0, leads: 0, reach: 0 }
      cur.spend += a.spend; cur.leads += a.leads; cur.reach += a.reach ?? 0
      map.set(key, cur)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, spend: Math.round(v.spend), leads: v.leads, reach: v.reach, cpl: v.leads > 0 ? Math.round(v.spend / v.leads) : 0 }))
  }, [filteredHistoricalAds, platform])

  // Seasonal aggregation - group monthly data into India's four broad seasons.
  const seasonalData = useMemo(() => {
    if (platform === 'youtube') return []
    const SEASONS = [
      { label: 'Winter\nDec–Feb',   months: [12, 1, 2] },
      { label: 'Spring\nMar–May',   months: [3, 4, 5] },
      { label: 'Monsoon\nJun–Sep',  months: [6, 7, 8, 9] },
      { label: 'Autumn\nOct–Nov',   months: [10, 11] },
    ]
    return SEASONS.map(({ label, months }) => {
      let spend = 0, leads = 0
      for (const a of filteredHistoricalAds) {
        const m = new Date(a.dateTo).getMonth() + 1
        if (months.includes(m)) { spend += a.spend; leads += a.leads }
      }
      return { season: label, spend: Math.round(spend), leads, cpl: leads > 0 ? Math.round(spend / leads) : 0 }
    })
  }, [filteredHistoricalAds, platform])

  const handleExport = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows: string[] = []

    rows.push('Performance Export')
    rows.push(`Date Range,${dateRange === 'all' ? 'All time' : dateRange}`)
    rows.push(`Platform,${platform}`)
    rows.push(`Exported,${new Date().toLocaleString()}`)
    rows.push('')

    rows.push('Summary')
    rows.push('Metric,Value')
    rows.push(`Total Spend,${summary.totalSpend.toFixed(2)}`)
    rows.push(`Total Reach,${summary.totalReach}`)
    rows.push(`Avg CPL,${summary.avgCpl.toFixed(2)}`)
    rows.push(`Avg CPM,${summary.avgCpm.toFixed(2)}`)
    rows.push(`Avg CTR,${summary.avgCtr.toFixed(2)}%`)
    rows.push('')

    if (sortedCreatives.length > 0) {
      rows.push('Live Creatives')
      rows.push('Creative,Impressions,Reach,Clicks,Spend,CPM,CTR,Frequency,CPL')
      for (const c of sortedCreatives) {
        const t = {
          impressions: c.snapshots.reduce((s, snap) => s + snap.impressions, 0),
          reach: c.snapshots.reduce((s, snap) => s + snap.reach, 0),
          clicks: c.snapshots.reduce((s, snap) => s + snap.clicks, 0),
          spend: c.snapshots.reduce((s, snap) => s + Number(snap.spend), 0),
          cpm: c.snapshots.reduce((s, snap) => s + Number(snap.cpm), 0) / c.snapshots.length,
          ctr: c.snapshots.reduce((s, snap) => s + Number(snap.ctr), 0) / c.snapshots.length * 100,
          freq: c.snapshots.reduce((s, snap) => s + Number(snap.frequency), 0) / c.snapshots.length,
          cpl: avgCplOf(c.snapshots),
        }
        rows.push(`${esc(c.idea.title)},${t.impressions},${t.reach},${t.clicks},${t.spend.toFixed(2)},${t.cpm.toFixed(2)},${t.ctr.toFixed(2)}%,${t.freq.toFixed(1)},${t.cpl.toFixed(2)}`)
      }
      rows.push('')
    }

    if (sortedImportedAds.length > 0) {
      rows.push('Imported Meta Ads')
      rows.push('Ad Name,Campaign,Spend,Reach,Leads,CPL,Date From,Date To')
      for (const ad of sortedImportedAds) {
        rows.push(`${esc(ad.adName)},${esc(ad.campaignName ?? '')},${ad.spend.toFixed(2)},${ad.reach ?? ''},${ad.leads},${ad.cpl.toFixed(2)},${new Date(ad.dateFrom).toLocaleDateString()},${new Date(ad.dateTo).toLocaleDateString()}`)
      }
      rows.push('')
    }

    if (importedMonthly.length > 0) {
      rows.push('Monthly Breakdown')
      rows.push('Month,Spend,Leads,Reach,CPL')
      for (const m of importedMonthly) {
        rows.push(`${m.month},${m.spend},${m.leads},${m.reach},${m.cpl}`)
      }
    }

    const csv = rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `performance-${dateRange}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // One sync: pulls daily performance AND hourly/day-of-week timing from Meta,
  // then refetches both without a page reload.
  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const [perfSync, timingSync] = await Promise.all([
        fetch('/api/performance/sync', { method: 'POST' }),
        fetch('/api/performance/timing-refresh', { method: 'POST' }),
      ])
      const from = rangeCutoff(dateRange).toISOString()
      const [perfRes, timingRes] = await Promise.all([
        fetch(`/api/performance?from=${from}`),
        fetch('/api/performance/timing-data'),
      ])
      if (perfRes.ok) setSnapshots((await perfRes.json()).snapshots)
      if (timingRes.ok) {
        const t = await timingRes.json()
        setTimingHourly(t.hourly)
        setTimingWeekday(t.weekday)
        setTimingDataAvailable(t.hasTimingData ?? true)
      }
      // Honest completion feedback - the button being re-enabled isn't enough.
      const timing = timingSync.ok ? await timingSync.json().catch(() => ({})) : null
      if (!perfSync.ok || !timingSync.ok) {
        setSyncMsg('Synced with errors - some data may not have updated.')
      } else {
        const tInfo = timing?.updated != null
          ? ` · timing: ${timing.updated} ads${timing.errors ? `, ${timing.errors} failed` : ''}`
          : ''
        setSyncMsg(`Last synced ${new Date().toLocaleTimeString()}${tInfo}`)
      }
    } catch {
      setSyncMsg('Sync failed - check your connection and try again.')
    } finally {
      setSyncing(false)
    }
  }

  type ImportedSortKey = 'adName' | 'campaignName' | 'spend' | 'reach' | 'leads' | 'cpl' | 'date'
  const [importedSortKey, setImportedSortKey] = useState<ImportedSortKey>('cpl')
  const [importedSortAsc, setImportedSortAsc] = useState(true)
  const [expandedImportedAdId, setExpandedImportedAdId] = useState<string | null>(null)
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const sortedImportedAds = useMemo(() => {
    return [...filteredHistoricalAds].sort((a, b) => {
      let av: number | string, bv: number | string
      switch (importedSortKey) {
        case 'adName':       av = a.adName;                          bv = b.adName; break
        case 'campaignName': av = a.campaignName ?? '';              bv = b.campaignName ?? ''; break
        case 'spend':        av = a.spend;                           bv = b.spend; break
        case 'reach':        av = a.reach ?? 0;                      bv = b.reach ?? 0; break
        case 'leads':        av = a.leads;                           bv = b.leads; break
        case 'cpl':          av = a.cpl;                             bv = b.cpl; break
        case 'date':         av = new Date(a.dateFrom).getTime();    bv = new Date(b.dateFrom).getTime(); break
        default:             av = 0; bv = 0
      }
      if (typeof av === 'string') return importedSortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
      return importedSortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [filteredHistoricalAds, importedSortKey, importedSortAsc])

  const handleImportedSort = (key: ImportedSortKey) => {
    if (importedSortKey === key) setImportedSortAsc(a => !a)
    else { setImportedSortKey(key); setImportedSortAsc(true) }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const SortHeader = ({ label, col }: { label: string; col: SortKey }) => (
    <th
      className="text-left text-xs text-brand-muted font-medium px-4 py-3 cursor-pointer hover:text-brand-dark select-none transition-colors"
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === col && (
          <span className="text-indigo-500">
            {sortAsc ? <ChevronUp /> : <ChevronDown />}
          </span>
        )}
      </span>
    </th>
  )

  const metricCards = [
    { label: 'Total Spend', value: inr(summary.totalSpend), accent: 'border-t-blue-500' },
    { label: 'Total Reach', value: summary.totalReach > 0 ? compact(summary.totalReach) : '-', accent: 'border-t-violet-500' },
    { label: 'Avg CPL', value: summary.avgCpl > 0 ? inr(summary.avgCpl) : '-', accent: 'border-t-emerald-500' },
    { label: 'Avg CPM', value: summary.avgCpm > 0 ? inr(summary.avgCpm, 2) : '-', accent: 'border-t-amber-500' },
    { label: 'Avg CTR', value: summary.avgCtr > 0 ? `${summary.avgCtr.toFixed(2)}%` : '-', accent: 'border-t-brand-accent' },
  ]

  return (
    <div className="p-6 space-y-6 animate-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-brand-dark">Performance</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-brand-border overflow-hidden text-sm">
            {([['all', 'All'], ['meta', 'Meta'], ['youtube', 'YouTube']] as const).map(([p, label]) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`px-3 py-1.5 transition-colors ${
                  platform === p
                    ? 'bg-brand text-white'
                    : 'text-brand-muted hover:text-brand-dark hover:bg-brand-bg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-brand-border overflow-hidden text-sm">
            {RANGE_OPTIONS.map(([r, label]) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`px-3 py-1.5 transition-colors ${
                  dateRange === r
                    ? 'bg-brand text-white'
                    : 'text-brand-muted hover:text-brand-dark hover:bg-brand-bg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={handleExport}
            className="text-sm border border-brand-border text-brand-muted hover:text-brand-dark hover:border-brand-divider px-3 py-1.5 rounded-lg transition-all duration-200"
            title="Export visible data as CSV"
          >
            Export CSV
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-sm border border-brand-border text-brand-muted hover:text-brand-dark hover:border-brand-divider px-3 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-50"
            title="Pull latest performance plus hourly & day-of-week timing from Meta"
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>
      {(syncing || syncMsg) && (
        <p className="text-xs text-brand-muted text-right -mt-3">
          {syncing ? 'Syncing performance + timing from Meta… this can take a moment for many ads.' : syncMsg}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {metricCards.map((card) => (
          <div key={card.label} className={`bg-white border border-brand-border border-t-2 ${card.accent} rounded-xl p-4 shadow-sm`}>
            <p className="text-xs text-brand-muted mb-1">{card.label}</p>
            <p className="text-2xl font-semibold text-brand-dark">{card.value}</p>
          </div>
        ))}
      </div>

      {filteredSnapshots.length > 0 ? (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white border border-brand-border rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-medium text-brand-dark mb-4">CPL over time (₹)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={cplChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--chart-tooltip-label)' }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: 'var(--chart-tick)' }} />
                {byCreative.slice(0, 5).map((c, i) => (
                  <Line key={c.idea.id} type="monotone" dataKey={c.idea.title.slice(0, 20)} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-brand-border rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-medium text-brand-dark mb-4">Spend vs Impressions (K)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={spendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: 'var(--chart-tick)' }} />
                <Bar dataKey="spend" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="impressions" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-brand-border rounded-xl p-12 text-center text-brand-muted">
          No live sync data yet - post a creative and sync to see time-series analytics.
        </div>
      )}

      {/* ── Monthly & Seasonal charts - always visible when historical data exists ── */}
      {platform !== 'youtube' && importedMonthly.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-medium text-brand-dark">Seasonal Performance</h2>
          <p className="text-xs text-brand-muted -mt-2">Historical data from Meta - filtered by the selected date range above.</p>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white border border-brand-border rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-medium text-brand-dark mb-4">Leads &amp; CPL by month</h3>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={importedMonthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="month" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `₹${compact(Number(v))}`} tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }} labelStyle={{ color: 'var(--chart-tooltip-label)' }} />
                  <Legend wrapperStyle={{ fontSize: 10, color: 'var(--chart-tick)' }} />
                  <Bar yAxisId="left" dataKey="leads" name="Leads" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="cpl" name="CPL ₹" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-brand-border rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-medium text-brand-dark mb-4">Spend &amp; reach by month</h3>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={importedMonthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="month" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} />
                  <YAxis yAxisId="left" tickFormatter={(v) => `₹${compact(Number(v))}`} tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => compact(Number(v))} tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }} labelStyle={{ color: 'var(--chart-tooltip-label)' }} />
                  <Legend wrapperStyle={{ fontSize: 10, color: 'var(--chart-tick)' }} />
                  <Bar yAxisId="left" dataKey="spend" name="Spend ₹" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="reach" name="Reach" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {seasonalData.some(s => s.leads > 0) && (
            <div className="grid grid-cols-4 gap-4">
              {seasonalData.map(s => (
                <div key={s.season} className="bg-white border border-brand-border rounded-xl p-4 shadow-sm">
                  <p className="text-xs text-brand-muted mb-2 whitespace-pre-line">{s.season}</p>
                  <p className="text-xl font-semibold text-brand-dark">{s.leads} leads</p>
                  <p className="text-xs text-brand-muted mt-1">{s.cpl > 0 ? `${inr(s.cpl)} CPL` : 'No leads'}</p>
                  <p className="text-xs text-brand-muted">{inr(s.spend)} spend</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-border bg-brand-bg">
              <th className="text-left text-xs text-brand-muted font-medium px-4 py-3">Creative</th>
              <SortHeader label="Impressions" col="impressions" />
              <SortHeader label="Reach" col="reach" />
              <SortHeader label="Clicks" col="clicks" />
              <SortHeader label="Spend" col="spend" />
              <SortHeader label="CPM" col="cpm" />
              <SortHeader label="CTR" col="ctr" />
              <SortHeader label="Freq" col="freq" />
              <SortHeader label="CPL" col="cpl" />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {sortedCreatives.map((c) => {
              const totals = {
                impressions: c.snapshots.reduce((s, snap) => s + snap.impressions, 0),
                reach: c.snapshots.reduce((s, snap) => s + snap.reach, 0),
                clicks: c.snapshots.reduce((s, snap) => s + snap.clicks, 0),
                spend: c.snapshots.reduce((s, snap) => s + Number(snap.spend), 0),
                cpm: c.snapshots.reduce((s, snap) => s + Number(snap.cpm), 0) / c.snapshots.length,
                ctr: c.snapshots.reduce((s, snap) => s + Number(snap.ctr), 0) / c.snapshots.length * 100,
                freq: c.snapshots.reduce((s, snap) => s + Number(snap.frequency), 0) / c.snapshots.length,
                cpl: avgCplOf(c.snapshots),
              }
              const isFatigued = totals.freq > 3
              return (
                <>
                  <tr
                    key={c.idea.id}
                    className={`border-b border-brand-border hover:bg-brand-bg cursor-pointer transition-colors ${isFatigued ? 'bg-amber-50/50' : ''}`}
                    onClick={() => setExpandedPost(expandedPost === c.idea.id ? null : c.idea.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-brand-dark font-medium">{c.idea.title}</span>
                        {isFatigued && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                            fatigued
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-brand-dark">{totals.impressions.toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-dark">{totals.reach.toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-dark">{totals.clicks.toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-dark">{inr(totals.spend)}</td>
                    <td className="px-4 py-3 text-brand-dark">{inr(totals.cpm, 2)}</td>
                    <td className="px-4 py-3 text-brand-dark">{totals.ctr.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-brand-dark">{totals.freq.toFixed(1)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${totals.cpl === 0 ? 'text-brand-muted' : totals.cpl <= CPL_GOOD ? 'text-emerald-600' : totals.cpl <= CPL_OK ? 'text-brand-dark' : 'text-red-600'}`}>
                        {totals.cpl > 0 ? inr(totals.cpl) : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-brand-muted">
                      {expandedPost === c.idea.id ? <ChevronUp /> : <ChevronDown />}
                    </td>
                  </tr>
                  {expandedPost === c.idea.id && (
                    <tr className="border-b border-brand-border bg-brand-bg/50">
                      <td colSpan={10} className="px-4 py-2">
                        <div className="text-xs text-brand-muted space-y-1 animate-reveal">
                          {c.snapshots.map((s) => (
                            <div key={s.id} className="flex gap-4">
                              <span className="text-brand-muted">{new Date(s.snapshotDate).toLocaleDateString()}</span>
                              <span>Impressions: {s.impressions.toLocaleString()}</span>
                              <span>CPL: {s.cpl != null ? inr(Number(s.cpl)) : '-'}</span>
                              <span>Leads: {s.leads}</span>
                              <span>Freq: {Number(s.frequency).toFixed(1)}</span>
                              <span>Spend: {inr(Number(s.spend))}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {sortedCreatives.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-brand-muted">No data</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {platform !== 'youtube' && (
        <div className="bg-white border border-brand-border rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-brand-dark">Timing Insights</h3>
              <p className="text-xs text-brand-muted mt-0.5">
                {timingDataAvailable
                  ? 'Aggregate view across all imported Meta ads. Click any ad below to see its individual timing breakdown.'
                  : 'No timing data yet - click "Sync" above to pull hourly and day-of-week breakdowns from Meta.'}
              </p>
            </div>
          </div>

          {timingDataAvailable && (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-brand-muted mb-3">Leads by hour of day (all ads)</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={timingHourly} barSize={8}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'var(--chart-tick)', fontSize: 9 }} tickLine={false} interval={3} />
                    <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 9 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }} />
                    <Bar dataKey="leads" name="Leads" fill="#6366f1" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-xs text-brand-muted mb-3">Leads by day of week (all ads)</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={timingWeekday} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 9 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }} />
                    <Bar dataKey="leads" name="Leads" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {platform !== 'youtube' && initialHistoricalAds.length > 0 && (
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border bg-brand-bg">
            <h3 className="text-sm font-medium text-brand-dark">Imported Meta ads ({importedSummary.count})</h3>
            <span className="text-xs text-brand-muted">
              Total spend {inr(importedSummary.totalSpend)} · Avg CPL {importedSummary.avgCpl > 0 ? inr(importedSummary.avgCpl) : '-'} · click any row for timing breakdown
            </span>
          </div>
          <div className="max-h-[36rem] overflow-y-auto overscroll-y-contain">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-brand-bg">
                <tr className="border-b border-brand-border">
                  {(
                    [
                      ['adName',       'Ad'],
                      ['campaignName', 'Campaign'],
                      ['spend',        'Spend'],
                      ['reach',        'Reach'],
                      ['leads',        'Leads'],
                      ['cpl',          'CPL'],
                      ['date',         'Dates'],
                    ] as [ImportedSortKey, string][]
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => handleImportedSort(key)}
                      className="text-left text-xs text-brand-muted font-medium px-4 py-3 cursor-pointer hover:text-brand-dark select-none transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <span className={importedSortKey === key ? 'text-indigo-500' : 'opacity-0'}>
                          {importedSortAsc ? <ChevronUp /> : <ChevronDown />}
                        </span>
                      </span>
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {sortedImportedAds.map((ad) => {
                  const isExpanded = expandedImportedAdId === ad.id
                  const hasAdTiming = !!(ad.hourlyBreakdown?.length)
                  const hourlyForAd = hasAdTiming
                    ? (ad.hourlyBreakdown as HRow[]).map(r => ({ ...r, label: `${r.hour}:00` }))
                    : null
                  const weekdayForAd = hasAdTiming && ad.weekdayBreakdown
                    ? (ad.weekdayBreakdown as WRow[]).map(r => ({ ...r, label: DAY_LABELS[r.day] ?? String(r.day) }))
                    : null

                  return (
                    <>
                      <tr
                        key={ad.id}
                        onClick={() => setExpandedImportedAdId(isExpanded ? null : ad.id)}
                        className={`border-b border-brand-border cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/40' : 'hover:bg-brand-bg'}`}
                      >
                        <td className="px-4 py-3 text-brand-dark max-w-[16rem] truncate" title={ad.adName}>{ad.adName}</td>
                        <td className="px-4 py-3 text-brand-muted max-w-[10rem] truncate" title={ad.campaignName ?? ''}>{ad.campaignName ?? '-'}</td>
                        <td className="px-4 py-3 text-brand-dark">{inr(ad.spend)}</td>
                        <td className="px-4 py-3 text-brand-dark">{ad.reach != null ? compact(ad.reach) : '-'}</td>
                        <td className="px-4 py-3 text-brand-dark">{ad.leads}</td>
                        <td className="px-4 py-3">
                          <span className={`font-medium ${ad.cpl <= CPL_GOOD ? 'text-emerald-600' : ad.cpl <= CPL_OK ? 'text-brand-dark' : 'text-red-600'}`}>
                            {inr(ad.cpl)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-brand-muted text-xs whitespace-nowrap">
                          {new Date(ad.dateFrom).toLocaleDateString()} - {new Date(ad.dateTo).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-brand-muted">
                          {isExpanded ? <ChevronUp /> : <ChevronDown />}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${ad.id}-timing`} className="border-b border-brand-border bg-brand-bg/50">
                          <td colSpan={8} className="px-4 py-4">
                            {hourlyForAd ? (
                              <div className="grid grid-cols-2 gap-6 animate-reveal">
                                <div>
                                  <p className="text-xs text-brand-muted mb-2">Leads by hour of day</p>
                                  <ResponsiveContainer width="100%" height={140}>
                                    <BarChart data={hourlyForAd} barSize={6}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                                      <XAxis dataKey="label" tick={{ fill: 'var(--chart-tick)', fontSize: 8 }} tickLine={false} interval={3} />
                                      <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 8 }} tickLine={false} axisLine={false} allowDecimals={false} />
                                      <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8, fontSize: 11 }} />
                                      <Bar dataKey="leads" name="Leads" fill="#6366f1" radius={[2, 2, 0, 0]} />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                                {weekdayForAd && (
                                  <div>
                                    <p className="text-xs text-brand-muted mb-2">Leads by day of week</p>
                                    <ResponsiveContainer width="100%" height={140}>
                                      <BarChart data={weekdayForAd} barSize={22}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                                        <XAxis dataKey="label" tick={{ fill: 'var(--chart-tick)', fontSize: 9 }} tickLine={false} />
                                        <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 8 }} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8, fontSize: 11 }} />
                                        <Bar dataKey="leads" name="Leads" fill="#10b981" radius={[3, 3, 0, 0]} />
                                      </BarChart>
                                    </ResponsiveContainer>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-brand-muted py-2">
                                No timing data for this ad yet. Click <span className="font-medium text-brand-dark">&ldquo;Sync&rdquo;</span> in the header to fetch hourly and day-of-week breakdowns from Meta.
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
