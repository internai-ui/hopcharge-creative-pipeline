'use client'

import { useState, useMemo, useEffect, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import {
  LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import type { PerformanceSnapshot, Post, Creative, Idea } from '@prisma/client'

type SnapshotWithRelations = PerformanceSnapshot & {
  post: Post & { creative: Creative & { idea: Idea } }
}

type CreativePerf = { idea: Idea; snapshots: SnapshotWithRelations[] }

type HRow = { hour: number; leads: number; spend: number; cpl: number }
type WRow = { day: number; leads: number; spend: number; cpl: number }

// A row imported from either platform - Meta (paid) columns are null on a YouTube
// row and vice versa. See prisma/schema.prisma HistoricalAd for the authoritative
// shape/reasoning.
type ImportedAd = {
  id: string
  metaAdId: string
  platform: string
  adName: string
  campaignName: string | null
  cpl: number | null
  leads: number
  spend: number | null
  impressions: number | null
  reach: number | null
  clicks: number | null
  cpm: number | null
  ctr: number | null
  isSuccessful: boolean | null
  views: number | null
  likesCount: number | null
  commentsCount: number | null
  externalWatchUrl: string | null
  creativeImagePath: string | null
  creativeType: string | null
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

// Meta (paid) sort keys vs YouTube (organic) sort keys - deliberately separate types
// so a Meta-only field (cpl, spend...) can never be selected while viewing YouTube,
// and vice versa. The underlying data reuses the same snapshot columns per the
// mapping documented in youtube/analytics.ts (impressions=views, clicks=likes).
type MetaSortKey = 'impressions' | 'reach' | 'clicks' | 'spend' | 'cpm' | 'ctr' | 'freq' | 'cpl'
type YoutubeSortKey = 'views' | 'likes' | 'comments' | 'engagement'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

// Business thresholds for cost-per-lead (₹). Lower is better. Meta only.
const CPL_GOOD = 100
const CPL_OK = 150

// Meta returns all monetary values in the ad account's currency. Hopcharge B2C
// is an INR account, so every spend/CPM/CPL figure is shown in ₹ (en-IN grouping).
const inr = (n: number, dp = 0) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`

// Compact large counts (reach/impressions/views) using Indian lakh/crore grouping.
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

// Average CPL across snapshots, ignoring days with no lead data. Meta only.
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

// Declared at module scope (not inside PerformanceClient) so they aren't recreated
// every render - state is passed in as props instead of closed over.
function MetaSortHeader({ label, col, activeKey, asc, onClick }: {
  label: string; col: MetaSortKey; activeKey: MetaSortKey; asc: boolean; onClick: (col: MetaSortKey) => void
}) {
  return (
    <th
      className="text-left text-xs text-brand-muted font-medium px-4 py-3 cursor-pointer hover:text-brand-dark select-none transition-colors"
      onClick={() => onClick(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {activeKey === col && (
          <span className="text-indigo-500">{asc ? <ChevronUp /> : <ChevronDown />}</span>
        )}
      </span>
    </th>
  )
}

function YtSortHeader({ label, col, activeKey, asc, onClick }: {
  label: string; col: YoutubeSortKey; activeKey: YoutubeSortKey; asc: boolean; onClick: (col: YoutubeSortKey) => void
}) {
  return (
    <th
      className="text-left text-xs text-brand-muted font-medium px-4 py-3 cursor-pointer hover:text-brand-dark select-none transition-colors"
      onClick={() => onClick(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {activeKey === col && (
          <span className="text-indigo-500">{asc ? <ChevronUp /> : <ChevronDown />}</span>
        )}
      </span>
    </th>
  )
}

export function PerformanceClient({ initialSnapshots, initialHistoricalAds, hourlyTimingData, weekdayTimingData, hasTimingData }: PerformanceClientProps) {
  const [snapshots, setSnapshots] = useState<SnapshotWithRelations[]>(initialSnapshots)
  const [dateRange, setDateRange] = useState('all')
  // No "All" option: Meta (paid ads) and YouTube (organic Shorts/videos) have
  // fundamentally different metrics - spend/CPL/CPM/frequency don't exist on an
  // organic video, and blending them into one table produced a page full of
  // meaningless ₹0/- rows for YouTube. Each platform gets its own view below.
  const [platform, setPlatform] = useState<'meta' | 'youtube'>('meta')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [timingHourly, setTimingHourly] = useState(hourlyTimingData)
  const [timingWeekday, setTimingWeekday] = useState(weekdayTimingData)
  const [timingDataAvailable, setTimingDataAvailable] = useState(hasTimingData)
  const [metaSortKey, setMetaSortKey] = useState<MetaSortKey>('cpl')
  const [metaSortAsc, setMetaSortAsc] = useState(true) // lower CPL first
  const [ytSortKey, setYtSortKey] = useState<YoutubeSortKey>('views')
  const [ytSortAsc, setYtSortAsc] = useState(false) // higher views first

  // Per-creative history drilldown (click a row → chart of its snapshots over time).
  const [historyCreative, setHistoryCreative] = useState<CreativePerf | null>(null)
  const [historyClosing, setHistoryClosing] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const closeHistory = useCallback(() => {
    setHistoryClosing(true)
    setTimeout(() => { setHistoryCreative(null); setHistoryClosing(false) }, 200)
  }, [])
  useEffect(() => {
    if (!historyCreative) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeHistory() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [historyCreative, closeHistory])

  const filteredSnapshots = useMemo(() => {
    const cutoff = rangeCutoff(dateRange)
    return snapshots.filter((s) =>
      new Date(s.snapshotDate) >= cutoff && s.post.platform === platform
    )
  }, [snapshots, dateRange, platform])

  // Historical ads filtered by platform + selected date range (dateTo must fall
  // within the window).
  const filteredHistoricalAds = useMemo(() => {
    const cutoff = rangeCutoff(dateRange)
    return initialHistoricalAds.filter(a => a.platform === platform && new Date(a.dateTo) >= cutoff)
  }, [initialHistoricalAds, dateRange, platform])

  // ── Meta summary (paid) ─────────────────────────────────────────────────────
  const metaSummary = useMemo(() => {
    const sum = (ns: (number | null)[]) => ns.reduce((s: number, v) => s + (v ?? 0), 0)
    const totalSpend = filteredSnapshots.reduce((s, snap) => s + Number(snap.spend ?? 0), 0) + sum(filteredHistoricalAds.map((a) => a.spend))
    const totalLeads = filteredSnapshots.reduce((s, snap) => s + (snap.leads ?? 0), 0) + sum(filteredHistoricalAds.map((a) => a.leads))
    const totalReach = filteredSnapshots.reduce((s, snap) => s + (snap.reach ?? 0), 0) + sum(filteredHistoricalAds.map((a) => a.reach))
    const totalImpr = filteredSnapshots.reduce((s, snap) => s + snap.impressions, 0) + sum(filteredHistoricalAds.map((a) => a.impressions))
    const totalClicks = filteredSnapshots.reduce((s, snap) => s + snap.clicks, 0) + sum(filteredHistoricalAds.map((a) => a.clicks))

    return {
      totalSpend,
      totalReach,
      avgCpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
      avgCpm: totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : 0,
      avgCtr: totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0,
    }
  }, [filteredSnapshots, filteredHistoricalAds])

  // ── YouTube summary (organic) - views/likes/comments, no spend/CPL/CPM/freq ──
  const youtubeSummary = useMemo(() => {
    const sum = (ns: (number | null)[]) => ns.reduce((s: number, v) => s + (v ?? 0), 0)
    const totalViews = filteredSnapshots.reduce((s, snap) => s + snap.impressions, 0) + sum(filteredHistoricalAds.map((a) => a.views))
    const totalLikes = filteredSnapshots.reduce((s, snap) => s + snap.clicks, 0) + sum(filteredHistoricalAds.map((a) => a.likesCount))
    const totalComments = filteredSnapshots.reduce((s, snap) => s + (snap.commentsCount ?? 0), 0) + sum(filteredHistoricalAds.map((a) => a.commentsCount))
    return {
      totalViews,
      totalLikes,
      totalComments,
      avgEngagementRate: totalViews > 0 ? (totalLikes / totalViews) * 100 : 0,
    }
  }, [filteredSnapshots, filteredHistoricalAds])

  const byCreative = useMemo(() => {
    const map = new Map<string, { idea: Idea; snapshots: SnapshotWithRelations[] }>()
    for (const snap of filteredSnapshots) {
      const key = snap.post.creative.idea.id
      if (!map.has(key)) map.set(key, { idea: snap.post.creative.idea, snapshots: [] })
      map.get(key)!.snapshots.push(snap)
    }
    return Array.from(map.entries()).map(([, v]) => v)
  }, [filteredSnapshots])

  const creativeTotals = useCallback((c: CreativePerf) => ({
    impressions: c.snapshots.reduce((s, snap) => s + snap.impressions, 0), // Meta: impressions. YouTube: views.
    reach: c.snapshots.reduce((s, snap) => s + (snap.reach ?? 0), 0),
    clicks: c.snapshots.reduce((s, snap) => s + snap.clicks, 0), // Meta: clicks. YouTube: likes.
    comments: c.snapshots.reduce((s, snap) => s + (snap.commentsCount ?? 0), 0),
    spend: c.snapshots.reduce((s, snap) => s + Number(snap.spend ?? 0), 0),
    cpm: c.snapshots.reduce((s, snap) => s + Number(snap.cpm ?? 0), 0) / (c.snapshots.length || 1),
    ctr: c.snapshots.reduce((s, snap) => s + Number(snap.ctr ?? 0), 0) / (c.snapshots.length || 1) * 100, // Meta: CTR%. YouTube: engagement rate%.
    freq: c.snapshots.reduce((s, snap) => s + Number(snap.frequency ?? 0), 0) / (c.snapshots.length || 1),
    cpl: avgCplOf(c.snapshots),
  }), [])

  const sortedCreativesMeta = useMemo(() => {
    return [...byCreative].sort((a, b) => {
      const aVal = creativeTotals(a)[metaSortKey]
      const bVal = creativeTotals(b)[metaSortKey]
      return metaSortAsc ? aVal - bVal : bVal - aVal
    })
  }, [byCreative, metaSortKey, metaSortAsc, creativeTotals])

  const sortedCreativesYoutube = useMemo(() => {
    const keyOf = (c: CreativePerf) => {
      const t = creativeTotals(c)
      switch (ytSortKey) {
        case 'views': return t.impressions
        case 'likes': return t.clicks
        case 'comments': return t.comments
        case 'engagement': return t.ctr
      }
    }
    return [...byCreative].sort((a, b) => (ytSortAsc ? keyOf(a) - keyOf(b) : keyOf(b) - keyOf(a)))
  }, [byCreative, ytSortKey, ytSortAsc, creativeTotals])

  const cplChartData = useMemo(() => {
    if (platform !== 'meta') return []
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
  }, [filteredSnapshots, byCreative, platform])

  const spendData = useMemo(() => {
    if (platform !== 'meta') return []
    return byCreative.map((c) => ({
      name: c.idea.title.slice(0, 15),
      spend: c.snapshots.reduce((s, snap) => s + Number(snap.spend ?? 0), 0),
      impressions: c.snapshots.reduce((s, snap) => s + snap.impressions, 0) / 1000,
    }))
  }, [byCreative, platform])

  const viewsChartData = useMemo(() => {
    if (platform !== 'youtube') return []
    const top5 = [...byCreative]
      .sort((a, b) => creativeTotals(b).impressions - creativeTotals(a).impressions)
      .slice(0, 5)
    const allDates = [...new Set(filteredSnapshots.map((s) => new Date(s.snapshotDate).toISOString().split('T')[0]))].sort()
    return allDates.map((date) => {
      const point: Record<string, unknown> = { date }
      for (const creative of top5) {
        const snap = creative.snapshots.find(
          (s) => new Date(s.snapshotDate).toISOString().split('T')[0] === date
        )
        if (snap) point[creative.idea.title.slice(0, 20)] = snap.impressions
      }
      return point
    })
  }, [filteredSnapshots, byCreative, platform, creativeTotals])

  const engagementData = useMemo(() => {
    if (platform !== 'youtube') return []
    return byCreative.map((c) => {
      const t = creativeTotals(c)
      return { name: c.idea.title.slice(0, 15), likes: t.clicks, comments: t.comments }
    })
  }, [byCreative, platform, creativeTotals])

  const importedSummary = useMemo(() => {
    if (platform === 'youtube') {
      const totalViews = filteredHistoricalAds.reduce((s, a) => s + (a.views ?? 0), 0)
      return { count: filteredHistoricalAds.length, totalViews }
    }
    if (filteredHistoricalAds.length === 0) return { count: 0, totalSpend: 0, avgCpl: 0 }
    const totalSpend = filteredHistoricalAds.reduce((s, a) => s + (a.spend ?? 0), 0)
    const totalLeads = filteredHistoricalAds.reduce((s, a) => s + a.leads, 0)
    return { count: filteredHistoricalAds.length, totalSpend, avgCpl: totalLeads > 0 ? totalSpend / totalLeads : 0 }
  }, [filteredHistoricalAds, platform])

  const importedMonthly = useMemo(() => {
    if (platform !== 'meta') return []
    const map = new Map<string, { spend: number; leads: number; reach: number }>()
    for (const a of filteredHistoricalAds) {
      const d = new Date(a.dateTo)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const cur = map.get(key) ?? { spend: 0, leads: 0, reach: 0 }
      cur.spend += a.spend ?? 0; cur.leads += a.leads; cur.reach += a.reach ?? 0
      map.set(key, cur)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, spend: Math.round(v.spend), leads: v.leads, reach: v.reach, cpl: v.leads > 0 ? Math.round(v.spend / v.leads) : 0 }))
  }, [filteredHistoricalAds, platform])

  // Seasonal aggregation - group monthly data into India's four broad seasons. Meta only.
  const seasonalData = useMemo(() => {
    if (platform !== 'meta') return []
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
        if (months.includes(m)) { spend += a.spend ?? 0; leads += a.leads }
      }
      return { season: label, spend: Math.round(spend), leads, cpl: leads > 0 ? Math.round(spend / leads) : 0 }
    })
  }, [filteredHistoricalAds, platform])

  const handleExport = () => {
    // Comprehensive export: the COMPLETE dataset (all time, BOTH platforms),
    // independent of the on-screen date/platform filters. A leading BOM keeps Excel
    // happy with UTF-8.
    const rows: string[] = []
    const cell = (v: unknown): string => {
      if (v == null) return ''
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const line = (...cells: unknown[]) => rows.push(cells.map(cell).join(','))
    const blank = () => rows.push('')
    const section = (title: string) => rows.push(`# ${title}`)
    const n2 = (v: unknown) => Number(v ?? 0).toFixed(2)
    const n1 = (v: unknown) => Number(v ?? 0).toFixed(1)
    const iso = (d: string | Date) => new Date(d).toISOString().split('T')[0]
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    const allSnaps = snapshots
    const allAds = initialHistoricalAds
    const metaAds = allAds.filter(a => a.platform !== 'youtube')
    const youtubeAds = allAds.filter(a => a.platform === 'youtube')
    const metaSnaps = allSnaps.filter(s => s.post.platform !== 'youtube')
    const youtubeSnaps = allSnaps.filter(s => s.post.platform === 'youtube')

    // ── Metadata ──
    section('Hopcharge Performance - Full Data Export')
    line('Exported', new Date().toLocaleString())
    line('Scope', 'Complete dataset (all time, both platforms) - not limited by on-screen filters')
    line('On-screen filter (reference only)', `range=${dateRange}, platform=${platform}`)
    line('Performance snapshots', allSnaps.length)
    line('Imported Meta ads', metaAds.length)
    line('Imported YouTube videos', youtubeAds.length)
    blank()

    // ── Overall summary (all data) - Meta (paid) only, YouTube has no spend/CPL ──
    const sSpend = metaSnaps.reduce((s, x) => s + Number(x.spend ?? 0), 0)
    const sLeads = metaSnaps.reduce((s, x) => s + (x.leads ?? 0), 0)
    const sReach = metaSnaps.reduce((s, x) => s + (x.reach ?? 0), 0)
    const sImpr = metaSnaps.reduce((s, x) => s + x.impressions, 0)
    const sClicks = metaSnaps.reduce((s, x) => s + x.clicks, 0)
    const aSpend = metaAds.reduce((s, a) => s + (a.spend ?? 0), 0)
    const aLeads = metaAds.reduce((s, a) => s + a.leads, 0)
    const aReach = metaAds.reduce((s, a) => s + (a.reach ?? 0), 0)
    const aImpr = metaAds.reduce((s, a) => s + (a.impressions ?? 0), 0)
    const aClicks = metaAds.reduce((s, a) => s + (a.clicks ?? 0), 0)
    const tSpend = sSpend + aSpend, tLeads = sLeads + aLeads, tReach = sReach + aReach, tImpr = sImpr + aImpr, tClicks = sClicks + aClicks
    section('Summary (Meta, all data)')
    line('Metric', 'Live pipeline', 'Imported Meta', 'Combined')
    line('Spend (INR)', n2(sSpend), n2(aSpend), n2(tSpend))
    line('Leads', sLeads, aLeads, tLeads)
    line('Reach', sReach, aReach, tReach)
    line('Impressions', sImpr, aImpr, tImpr)
    line('Clicks', sClicks, aClicks, tClicks)
    line('Blended CPL (INR)', sLeads ? n2(sSpend / sLeads) : '', aLeads ? n2(aSpend / aLeads) : '', tLeads ? n2(tSpend / tLeads) : '')
    line('Blended CPM (INR)', sImpr ? n2((sSpend / sImpr) * 1000) : '', aImpr ? n2((aSpend / aImpr) * 1000) : '', tImpr ? n2((tSpend / tImpr) * 1000) : '')
    line('Blended CTR (%)', sImpr ? n2((sClicks / sImpr) * 100) : '', aImpr ? n2((aClicks / aImpr) * 100) : '', tImpr ? n2((tClicks / tImpr) * 100) : '')
    blank()

    // ── Overall summary (all data) - YouTube (organic), views/likes/comments ──
    const yViews = youtubeSnaps.reduce((s, x) => s + x.impressions, 0) + youtubeAds.reduce((s, a) => s + (a.views ?? 0), 0)
    const yLikes = youtubeSnaps.reduce((s, x) => s + x.clicks, 0) + youtubeAds.reduce((s, a) => s + (a.likesCount ?? 0), 0)
    const yComments = youtubeSnaps.reduce((s, x) => s + (x.commentsCount ?? 0), 0) + youtubeAds.reduce((s, a) => s + (a.commentsCount ?? 0), 0)
    section('Summary (YouTube, all data)')
    line('Metric', 'Value')
    line('Views', yViews)
    line('Likes', yLikes)
    line('Comments', yComments)
    line('Engagement rate (%)', yViews ? n2((yLikes / yViews) * 100) : '')
    blank()

    // ── Live creatives - aggregated across ALL snapshots, both platforms ──
    const byIdea = new Map<string, { idea: Idea; snaps: SnapshotWithRelations[]; platforms: Set<string>; creativeIds: Set<string> }>()
    for (const snap of allSnaps) {
      const idea = snap.post.creative.idea
      let g = byIdea.get(idea.id)
      if (!g) { g = { idea, snaps: [], platforms: new Set(), creativeIds: new Set() }; byIdea.set(idea.id, g) }
      g.snaps.push(snap)
      g.platforms.add(snap.post.platform)
      g.creativeIds.add(snap.post.creative.id)
    }
    if (byIdea.size > 0) {
      section('Live Creatives - aggregated (both platforms - Meta fields blank for YouTube-only ideas)')
      line('Idea', 'Idea ID', 'Angle', 'Funnel', 'Platforms', 'Creative IDs', 'Snapshots', 'First date', 'Last date', 'Impressions/Views', 'Reach', 'Clicks/Likes', 'Comments', 'Spend', 'Leads', 'Avg CPM', 'Avg CTR/Engagement %', 'Avg Frequency', 'Avg CPL')
      const groups = [...byIdea.values()].sort((a, b) => avgCplOf(a.snaps) - avgCplOf(b.snaps))
      for (const g of groups) {
        const dates = g.snaps.map((s) => iso(s.snapshotDate)).sort()
        const impressions = g.snaps.reduce((s, x) => s + x.impressions, 0)
        const reach = g.snaps.reduce((s, x) => s + (x.reach ?? 0), 0)
        const clicks = g.snaps.reduce((s, x) => s + x.clicks, 0)
        const comments = g.snaps.reduce((s, x) => s + (x.commentsCount ?? 0), 0)
        const spend = g.snaps.reduce((s, x) => s + Number(x.spend ?? 0), 0)
        const leads = g.snaps.reduce((s, x) => s + (x.leads ?? 0), 0)
        const cpm = g.snaps.reduce((s, x) => s + Number(x.cpm ?? 0), 0) / g.snaps.length
        const ctr = (g.snaps.reduce((s, x) => s + Number(x.ctr ?? 0), 0) / g.snaps.length) * 100
        const freq = g.snaps.reduce((s, x) => s + Number(x.frequency ?? 0), 0) / g.snaps.length
        line(g.idea.title, g.idea.id, g.idea.angle, g.idea.funnelStage ?? '', [...g.platforms].join('|'), [...g.creativeIds].join('|'), g.snaps.length, dates[0], dates[dates.length - 1], impressions, reach, clicks, comments, n2(spend), leads, n2(cpm), n2(ctr), n1(freq), n2(avgCplOf(g.snaps)))
      }
      blank()
    }

    // ── Performance snapshots - raw daily rows (all, both platforms) ──
    if (allSnaps.length > 0) {
      section('Performance Snapshots - daily (raw)')
      line('Date', 'Platform', 'Post status', 'External post ID', 'Idea', 'Angle', 'Funnel', 'Creative ID', 'Media type', 'Generator', 'Post ID', 'Impressions/Views', 'Reach', 'Clicks/Likes', 'Comments', 'Spend', 'CPM', 'CTR/Engagement %', 'Frequency', 'Leads', 'CPL')
      const sorted = [...allSnaps].sort((a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime())
      for (const s of sorted) {
        const cr = s.post.creative
        line(iso(s.snapshotDate), s.post.platform, s.post.status, s.post.externalPostId ?? '', cr.idea.title, cr.idea.angle, cr.idea.funnelStage ?? '', cr.id, cr.mediaType, cr.generatorName, s.post.id, s.impressions, s.reach ?? '', s.clicks, s.commentsCount ?? '', s.spend != null ? n2(s.spend) : '', s.cpm != null ? n2(s.cpm) : '', s.ctr != null ? n2(Number(s.ctr) * 100) : '', s.frequency != null ? n1(s.frequency) : '', s.leads ?? 0, s.cpl != null ? n2(s.cpl) : '')
      }
      blank()
    }

    // ── Imported Meta ads - full (all columns) ──
    if (metaAds.length > 0) {
      section('Imported Meta Ads - full')
      line('Ad name', 'Meta ad ID', 'Campaign', 'Successful', 'Spend', 'Leads', 'CPL', 'Impressions', 'Reach', 'Clicks', 'CPM', 'CTR %', 'Date from', 'Date to', 'Has hourly', 'Has weekday')
      for (const a of [...metaAds].sort((x, y) => (x.cpl ?? 0) - (y.cpl ?? 0))) {
        line(a.adName, a.metaAdId, a.campaignName ?? '', a.isSuccessful ? 'yes' : 'no', n2(a.spend), a.leads, a.cpl != null ? n2(a.cpl) : '', a.impressions ?? '', a.reach ?? '', a.clicks ?? '', a.cpm != null ? n2(a.cpm) : '', a.ctr != null ? n2(a.ctr) : '', iso(a.dateFrom), iso(a.dateTo), a.hourlyBreakdown?.length ? 'yes' : 'no', a.weekdayBreakdown?.length ? 'yes' : 'no')
      }
      blank()
    }

    // ── Imported YouTube videos - full (all columns) ──
    if (youtubeAds.length > 0) {
      section('Imported YouTube Videos - full')
      line('Title', 'Video ID', 'Views', 'Likes', 'Comments', 'Engagement %', 'Published', 'Watch URL')
      for (const a of [...youtubeAds].sort((x, y) => (y.views ?? 0) - (x.views ?? 0))) {
        const eng = a.views ? ((a.likesCount ?? 0) / a.views) * 100 : 0
        line(a.adName, a.metaAdId, a.views ?? 0, a.likesCount ?? 0, a.commentsCount ?? 0, n2(eng), iso(a.dateFrom), a.externalWatchUrl ?? '')
      }
      blank()
    }

    // ── Imported Meta ads - per-ad hourly breakdown ──
    const adsHourly = metaAds.filter((a) => a.hourlyBreakdown && a.hourlyBreakdown.length)
    if (adsHourly.length > 0) {
      section('Imported Meta Ads - hourly breakdown (per ad)')
      line('Ad name', 'Meta ad ID', 'Hour', 'Leads', 'Spend', 'CPL')
      for (const a of adsHourly) for (const h of a.hourlyBreakdown!) line(a.adName, a.metaAdId, h.hour, h.leads, n2(h.spend), n2(h.cpl))
      blank()
    }

    // ── Imported Meta ads - per-ad weekday breakdown ──
    const adsWeekday = metaAds.filter((a) => a.weekdayBreakdown && a.weekdayBreakdown.length)
    if (adsWeekday.length > 0) {
      section('Imported Meta Ads - weekday breakdown (per ad)')
      line('Ad name', 'Meta ad ID', 'Day (0=Sun)', 'Day', 'Leads', 'Spend', 'CPL')
      for (const a of adsWeekday) for (const w of a.weekdayBreakdown!) line(a.adName, a.metaAdId, w.day, DAYS[w.day] ?? '', w.leads, n2(w.spend), n2(w.cpl))
      blank()
    }

    // ── Aggregated timing - hourly / weekday (all Meta ads) ──
    if (timingHourly.length > 0) {
      section('Aggregated Timing - hourly (all Meta ads)')
      line('Hour', 'Label', 'Leads', 'Spend', 'CPL')
      for (const h of timingHourly) line(h.hour, h.label, h.leads, h.spend, h.cpl)
      blank()
    }
    if (timingWeekday.length > 0) {
      section('Aggregated Timing - weekday (all Meta ads)')
      line('Day (0=Sun)', 'Label', 'Leads', 'Spend', 'CPL')
      for (const w of timingWeekday) line(w.day, w.label, w.leads, w.spend, w.cpl)
      blank()
    }

    // ── Monthly breakdown (imported Meta ads) ──
    const monthly = new Map<string, { spend: number; leads: number; reach: number }>()
    for (const a of metaAds) {
      const d = new Date(a.dateTo)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const cur = monthly.get(key) ?? { spend: 0, leads: 0, reach: 0 }
      cur.spend += a.spend ?? 0; cur.leads += a.leads; cur.reach += a.reach ?? 0
      monthly.set(key, cur)
    }
    if (monthly.size > 0) {
      section('Monthly Breakdown (imported Meta ads)')
      line('Month', 'Spend', 'Leads', 'Reach', 'CPL')
      for (const [month, v] of [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        line(month, Math.round(v.spend), v.leads, v.reach, v.leads > 0 ? Math.round(v.spend / v.leads) : 0)
      }
      blank()
    }

    // ── Seasonal breakdown (imported Meta ads) ──
    if (metaAds.length > 0) {
      const SEASONS: [string, number[]][] = [['Winter (Dec-Feb)', [12, 1, 2]], ['Spring (Mar-May)', [3, 4, 5]], ['Monsoon (Jun-Sep)', [6, 7, 8, 9]], ['Autumn (Oct-Nov)', [10, 11]]]
      section('Seasonal Breakdown (imported Meta ads)')
      line('Season', 'Spend', 'Leads', 'CPL')
      for (const [label, months] of SEASONS) {
        let spend = 0, leads = 0
        for (const a of metaAds) { const m = new Date(a.dateTo).getMonth() + 1; if (months.includes(m)) { spend += a.spend ?? 0; leads += a.leads } }
        line(label, Math.round(spend), leads, leads > 0 ? Math.round(spend / leads) : 0)
      }
      blank()
    }

    const csv = '﻿' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hopcharge-performance-full-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // One sync: pulls daily performance from both platforms, AND hourly/day-of-week
  // timing from Meta (the only platform that has ad-scheduling-relevant timing).
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
        const tErr = timing?.errors && timing?.lastError
          ? ` - ${String(timing.lastError).slice(0, 160)}`
          : ''
        setSyncMsg(`Last synced ${new Date().toLocaleTimeString()}${tInfo}${tErr}`)
      }
    } catch {
      setSyncMsg('Sync failed - check your connection and try again.')
    } finally {
      setSyncing(false)
    }
  }

  type ImportedSortKey = 'adName' | 'campaignName' | 'spend' | 'reach' | 'leads' | 'cpl' | 'date' | 'views' | 'likes' | 'comments'
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
        case 'spend':        av = a.spend ?? 0;                      bv = b.spend ?? 0; break
        case 'reach':        av = a.reach ?? 0;                      bv = b.reach ?? 0; break
        case 'leads':        av = a.leads;                           bv = b.leads; break
        case 'cpl':          av = a.cpl ?? 0;                        bv = b.cpl ?? 0; break
        case 'views':        av = a.views ?? 0;                      bv = b.views ?? 0; break
        case 'likes':        av = a.likesCount ?? 0;                 bv = b.likesCount ?? 0; break
        case 'comments':     av = a.commentsCount ?? 0;              bv = b.commentsCount ?? 0; break
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

  const handleMetaSort = (key: MetaSortKey) => {
    if (metaSortKey === key) { setMetaSortAsc(!metaSortAsc) } else { setMetaSortKey(key); setMetaSortAsc(false) }
  }
  const handleYtSort = (key: YoutubeSortKey) => {
    if (ytSortKey === key) { setYtSortAsc(!ytSortAsc) } else { setYtSortKey(key); setYtSortAsc(false) }
  }

  const metaMetricCards = [
    { label: 'Total Spend', value: inr(metaSummary.totalSpend), accent: 'border-t-blue-500' },
    { label: 'Total Reach', value: metaSummary.totalReach > 0 ? compact(metaSummary.totalReach) : '-', accent: 'border-t-violet-500' },
    { label: 'Avg CPL', value: metaSummary.avgCpl > 0 ? inr(metaSummary.avgCpl) : '-', accent: 'border-t-emerald-500' },
    { label: 'Avg CPM', value: metaSummary.avgCpm > 0 ? inr(metaSummary.avgCpm, 2) : '-', accent: 'border-t-amber-500' },
    { label: 'Avg CTR', value: metaSummary.avgCtr > 0 ? `${metaSummary.avgCtr.toFixed(2)}%` : '-', accent: 'border-t-brand-accent' },
  ]

  const youtubeMetricCards = [
    { label: 'Total Views', value: youtubeSummary.totalViews > 0 ? compact(youtubeSummary.totalViews) : '-', accent: 'border-t-red-500' },
    { label: 'Total Likes', value: youtubeSummary.totalLikes > 0 ? compact(youtubeSummary.totalLikes) : '-', accent: 'border-t-blue-500' },
    { label: 'Total Comments', value: youtubeSummary.totalComments > 0 ? compact(youtubeSummary.totalComments) : '-', accent: 'border-t-violet-500' },
    { label: 'Avg Engagement Rate', value: youtubeSummary.avgEngagementRate > 0 ? `${youtubeSummary.avgEngagementRate.toFixed(2)}%` : '-', accent: 'border-t-emerald-500' },
  ]

  return (
    <div className="p-6 space-y-6 animate-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-brand-dark">Performance</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-brand-border overflow-hidden text-sm">
            {([['meta', 'Meta'], ['youtube', 'YouTube']] as const).map(([p, label]) => (
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
            title="Export the complete dataset (all time, both platforms) as a multi-section CSV"
          >
            Export full CSV
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-sm border border-brand-border text-brand-muted hover:text-brand-dark hover:border-brand-divider px-3 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-50"
            title="Pull latest performance from both platforms, plus hourly & day-of-week timing from Meta"
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>
      {(syncing || syncMsg) && (
        <p className="text-xs text-brand-muted text-right -mt-3">
          {syncing ? 'Syncing performance + timing… this can take a moment for many ads.' : syncMsg}
        </p>
      )}

      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-4 ${platform === 'meta' ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {(platform === 'meta' ? metaMetricCards : youtubeMetricCards).map((card) => (
          <div key={card.label} className={`bg-white border border-brand-border border-t-2 ${card.accent} rounded-xl p-4 shadow-sm`}>
            <p className="text-xs text-brand-muted mb-1">{card.label}</p>
            <p className="text-2xl font-semibold text-brand-dark">{card.value}</p>
          </div>
        ))}
      </div>

      {filteredSnapshots.length > 0 ? (
        <div className="grid grid-cols-2 gap-6">
          {platform === 'meta' ? (
            <>
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
            </>
          ) : (
            <>
              <div className="bg-white border border-brand-border rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-medium text-brand-dark mb-4">Views over time</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={viewsChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="date" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(Number(v))} />
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
                <h3 className="text-sm font-medium text-brand-dark mb-4">Likes vs Comments</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={engagementData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, color: 'var(--chart-tick)' }} />
                    <Bar dataKey="likes" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="comments" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white border border-brand-border rounded-xl p-12 text-center text-brand-muted">
          No live sync data yet - post a creative and sync to see time-series analytics.
        </div>
      )}

      {/* ── Monthly & Seasonal charts - Meta only (spend-based, no YouTube equivalent) ── */}
      {platform === 'meta' && importedMonthly.length > 0 && (
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

      {platform === 'meta' ? (
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-border bg-brand-bg">
                <th className="text-left text-xs text-brand-muted font-medium px-4 py-3">Creative</th>
                <MetaSortHeader label="Impressions" col="impressions" activeKey={metaSortKey} asc={metaSortAsc} onClick={handleMetaSort} />
                <MetaSortHeader label="Reach" col="reach" activeKey={metaSortKey} asc={metaSortAsc} onClick={handleMetaSort} />
                <MetaSortHeader label="Clicks" col="clicks" activeKey={metaSortKey} asc={metaSortAsc} onClick={handleMetaSort} />
                <MetaSortHeader label="Spend" col="spend" activeKey={metaSortKey} asc={metaSortAsc} onClick={handleMetaSort} />
                <MetaSortHeader label="CPM" col="cpm" activeKey={metaSortKey} asc={metaSortAsc} onClick={handleMetaSort} />
                <MetaSortHeader label="CTR" col="ctr" activeKey={metaSortKey} asc={metaSortAsc} onClick={handleMetaSort} />
                <MetaSortHeader label="Freq" col="freq" activeKey={metaSortKey} asc={metaSortAsc} onClick={handleMetaSort} />
                <MetaSortHeader label="CPL" col="cpl" activeKey={metaSortKey} asc={metaSortAsc} onClick={handleMetaSort} />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sortedCreativesMeta.map((c) => {
                const totals = creativeTotals(c)
                const isFatigued = totals.freq > 3
                return (
                  <tr
                    key={c.idea.id}
                    className={`border-b border-brand-border hover:bg-brand-bg cursor-pointer transition-colors ${isFatigued ? 'bg-amber-50/50' : ''}`}
                    onClick={() => setHistoryCreative(c)}
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
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-medium text-brand whitespace-nowrap">History &rarr;</span>
                    </td>
                  </tr>
                )
              })}
              {sortedCreativesMeta.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-brand-muted">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-border bg-brand-bg">
                <th className="text-left text-xs text-brand-muted font-medium px-4 py-3">Video</th>
                <YtSortHeader label="Views" col="views" activeKey={ytSortKey} asc={ytSortAsc} onClick={handleYtSort} />
                <YtSortHeader label="Likes" col="likes" activeKey={ytSortKey} asc={ytSortAsc} onClick={handleYtSort} />
                <YtSortHeader label="Comments" col="comments" activeKey={ytSortKey} asc={ytSortAsc} onClick={handleYtSort} />
                <YtSortHeader label="Engagement rate" col="engagement" activeKey={ytSortKey} asc={ytSortAsc} onClick={handleYtSort} />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sortedCreativesYoutube.map((c) => {
                const totals = creativeTotals(c)
                return (
                  <tr
                    key={c.idea.id}
                    className="border-b border-brand-border hover:bg-brand-bg cursor-pointer transition-colors"
                    onClick={() => setHistoryCreative(c)}
                  >
                    <td className="px-4 py-3">
                      <span className="text-brand-dark font-medium">{c.idea.title}</span>
                    </td>
                    <td className="px-4 py-3 text-brand-dark">{totals.impressions.toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-dark">{totals.clicks.toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-dark">{totals.comments.toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-dark">{totals.ctr.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-medium text-brand whitespace-nowrap">History &rarr;</span>
                    </td>
                  </tr>
                )
              })}
              {sortedCreativesYoutube.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-muted">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {platform === 'meta' && (
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

      {platform === 'meta' && filteredHistoricalAds.length > 0 && (
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border bg-brand-bg">
            <h3 className="text-sm font-medium text-brand-dark">Imported Meta ads ({importedSummary.count})</h3>
            <span className="text-xs text-brand-muted">
              Total spend {inr(importedSummary.totalSpend ?? 0)} · Avg CPL {importedSummary.avgCpl ? inr(importedSummary.avgCpl) : '-'} · click any row for timing breakdown
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
                    <Fragment key={ad.id}>
                      <tr
                        onClick={() => setExpandedImportedAdId(isExpanded ? null : ad.id)}
                        className={`border-b border-brand-border cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/40' : 'hover:bg-brand-bg'}`}
                      >
                        <td className="px-4 py-3 text-brand-dark max-w-[16rem] truncate" title={ad.adName}>{ad.adName}</td>
                        <td className="px-4 py-3 text-brand-muted max-w-[10rem] truncate" title={ad.campaignName ?? ''}>{ad.campaignName ?? '-'}</td>
                        <td className="px-4 py-3 text-brand-dark">{ad.spend != null ? inr(ad.spend) : '-'}</td>
                        <td className="px-4 py-3 text-brand-dark">{ad.reach != null ? compact(ad.reach) : '-'}</td>
                        <td className="px-4 py-3 text-brand-dark">{ad.leads}</td>
                        <td className="px-4 py-3">
                          <span className={`font-medium ${ad.cpl == null ? 'text-brand-muted' : ad.cpl <= CPL_GOOD ? 'text-emerald-600' : ad.cpl <= CPL_OK ? 'text-brand-dark' : 'text-red-600'}`}>
                            {ad.cpl != null ? inr(ad.cpl) : '-'}
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
                        <tr className="border-b border-brand-border bg-brand-bg/50">
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
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {platform === 'youtube' && filteredHistoricalAds.length > 0 && (
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border bg-brand-bg">
            <h3 className="text-sm font-medium text-brand-dark">Imported YouTube videos ({importedSummary.count})</h3>
            <span className="text-xs text-brand-muted">Total views {compact(importedSummary.totalViews ?? 0)}</span>
          </div>
          <div className="max-h-[36rem] overflow-y-auto overscroll-y-contain">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-brand-bg">
                <tr className="border-b border-brand-border">
                  {(
                    [
                      ['adName', 'Video'],
                      ['views', 'Views'],
                      ['likes', 'Likes'],
                      ['comments', 'Comments'],
                      ['date', 'Published'],
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
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {sortedImportedAds.map((ad) => (
                  <tr key={ad.id} className="border-b border-brand-border hover:bg-brand-bg transition-colors">
                    <td className="px-4 py-3 text-brand-dark max-w-[16rem] truncate" title={ad.adName}>{ad.adName}</td>
                    <td className="px-4 py-3 text-brand-dark">{(ad.views ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-dark">{(ad.likesCount ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-dark">{(ad.commentsCount ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-muted text-xs whitespace-nowrap">{new Date(ad.dateFrom).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      {ad.externalWatchUrl && (
                        <a href={ad.externalWatchUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-red-600 hover:text-red-700 font-medium">Watch ↗</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mounted && historyCreative && (
        <PostHistoryModal data={historyCreative} closing={historyClosing} onClose={closeHistory} />
      )}
    </div>
  )
}

// ── Per-creative history drilldown (opened from a live-posts row) ──────────────
// Charts one creative's snapshots over time - Meta: leads bars + CPL line, YouTube:
// views bars + likes line (no leads/CPL on an organic video). Data is already
// client-side (the page loads all snapshots), so no fetch is needed. Modal matches
// the app's overlay conventions.
function PostHistoryModal({
  data, closing, onClose,
}: {
  data: CreativePerf
  closing: boolean
  onClose: () => void
}) {
  const { idea, snapshots } = data
  const ordered = [...snapshots].sort(
    (a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime(),
  )
  const isYoutube = snapshots[0]?.post.platform === 'youtube'
  const series = ordered.map((s) => ({
    date: new Date(s.snapshotDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    cpl: s.cpl != null ? Number(s.cpl) : null,
    leads: s.leads,
    spend: Number(s.spend ?? 0),
    views: s.impressions,
    likes: s.clicks,
  }))
  const platform = isYoutube ? 'YouTube' : 'Meta'
  const totalLeads = snapshots.reduce((n, s) => n + s.leads, 0)
  const totalSpend = snapshots.reduce((n, s) => n + Number(s.spend ?? 0), 0)
  const totalImpr = snapshots.reduce((n, s) => n + s.impressions, 0)
  const totalLikes = snapshots.reduce((n, s) => n + s.clicks, 0)
  const totalComments = snapshots.reduce((n, s) => n + (s.commentsCount ?? 0), 0)
  const avgCpl = avgCplOf(snapshots)
  const hasCpl = series.some((p) => p.cpl != null)

  const tiles: [string, string][] = isYoutube
    ? [
        ['Days tracked', String(snapshots.length)],
        ['Views', compact(totalImpr)],
        ['Likes', compact(totalLikes)],
        ['Comments', compact(totalComments)],
        ['Engagement rate', totalImpr > 0 ? `${((totalLikes / totalImpr) * 100).toFixed(2)}%` : '-'],
      ]
    : [
        ['Days tracked', String(snapshots.length)],
        ['Impressions', compact(totalImpr)],
        ['Leads', totalLeads.toLocaleString('en-IN')],
        ['Spend', inr(totalSpend)],
        ['Avg CPL', avgCpl > 0 ? inr(avgCpl) : '-'],
      ]

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center p-4 overflow-auto overlay-backdrop ${closing ? 'animate-fade-out-overlay' : 'animate-fade-overlay'}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`bg-white rounded-2xl w-full max-w-3xl mt-6 shadow-2xl ring-1 ring-brand-border overflow-hidden ${closing ? 'animate-modal-out' : 'animate-modal-in'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded text-white ${platform === 'YouTube' ? 'bg-red-600' : 'bg-[#1877f2]'}`}>{platform}</span>
              <h2 className="font-semibold text-brand-dark truncate">{idea.title}</h2>
            </div>
            <p className="text-xs text-brand-muted mt-0.5">Performance history</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-dark hover:bg-brand-surface transition-colors">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[calc(100vh-10rem)] overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {tiles.map(([label, val]) => (
              <div key={label} className="rounded-lg bg-brand-bg border border-brand-border px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">{label}</p>
                <p className="text-sm font-semibold text-brand-dark mt-0.5">{val}</p>
              </div>
            ))}
          </div>

          {series.length === 0 ? (
            <p className="text-sm text-brand-muted text-center py-8">No snapshots yet for this creative.</p>
          ) : isYoutube ? (
            <div>
              <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-2">Views &amp; likes over time</h3>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} minTickGap={16} />
                  <YAxis yAxisId="left" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="views" name="Views" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" dataKey="likes" name="Likes" stroke="#6366f1" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div>
              <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-2">Leads &amp; CPL over time</h3>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} minTickGap={16} />
                  <YAxis yAxisId="left" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="leads" name="Leads" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  {hasCpl && <Line yAxisId="right" dataKey="cpl" name="CPL (₹)" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {ordered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-border text-left text-xs text-brand-muted">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    {isYoutube ? (
                      <>
                        <th className="py-2 px-3 font-medium">Views</th>
                        <th className="py-2 px-3 font-medium">Likes</th>
                        <th className="py-2 pl-3 font-medium">Comments</th>
                      </>
                    ) : (
                      <>
                        <th className="py-2 px-3 font-medium">Impressions</th>
                        <th className="py-2 px-3 font-medium">Clicks</th>
                        <th className="py-2 px-3 font-medium">Spend</th>
                        <th className="py-2 px-3 font-medium">Freq</th>
                        <th className="py-2 px-3 font-medium">Leads</th>
                        <th className="py-2 pl-3 font-medium">CPL</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((s) => {
                    const cpl = s.cpl != null ? Number(s.cpl) : null
                    return (
                      <tr key={s.id} className="border-b border-brand-border/60">
                        <td className="py-2 pr-3 text-brand-muted whitespace-nowrap">{new Date(s.snapshotDate).toLocaleDateString('en-IN')}</td>
                        {isYoutube ? (
                          <>
                            <td className="py-2 px-3 text-brand-dark">{s.impressions.toLocaleString('en-IN')}</td>
                            <td className="py-2 px-3 text-brand-dark">{s.clicks.toLocaleString('en-IN')}</td>
                            <td className="py-2 pl-3 text-brand-dark">{(s.commentsCount ?? 0).toLocaleString('en-IN')}</td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 px-3 text-brand-dark">{s.impressions.toLocaleString('en-IN')}</td>
                            <td className="py-2 px-3 text-brand-dark">{s.clicks.toLocaleString('en-IN')}</td>
                            <td className="py-2 px-3 text-brand-dark">{inr(Number(s.spend ?? 0))}</td>
                            <td className="py-2 px-3 text-brand-dark">{Number(s.frequency ?? 0).toFixed(1)}</td>
                            <td className="py-2 px-3 text-brand-dark">{s.leads}</td>
                            <td className={`py-2 pl-3 font-medium ${cpl == null ? 'text-brand-muted' : cpl <= CPL_GOOD ? 'text-emerald-600' : cpl <= CPL_OK ? 'text-brand-dark' : 'text-red-600'}`}>
                              {cpl != null ? inr(cpl) : '-'}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
