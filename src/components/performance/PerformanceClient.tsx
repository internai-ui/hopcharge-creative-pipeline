'use client'

import { useState, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import type { PerformanceSnapshot, Post, Creative, Idea } from '@prisma/client'

type SnapshotWithRelations = PerformanceSnapshot & {
  post: Post & { creative: Creative & { idea: Idea } }
}

interface PerformanceClientProps {
  initialSnapshots: SnapshotWithRelations[]
}

type SortKey = 'impressions' | 'reach' | 'clicks' | 'spend' | 'cpm' | 'ctr' | 'freq' | 'roas'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

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

export function PerformanceClient({ initialSnapshots }: PerformanceClientProps) {
  const [snapshots, setSnapshots] = useState<SnapshotWithRelations[]>(initialSnapshots)
  const [dateRange, setDateRange] = useState('30d')
  const [syncing, setSyncing] = useState(false)
  const [expandedPost, setExpandedPost] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('roas')
  const [sortAsc, setSortAsc] = useState(false)

  const filteredSnapshots = useMemo(() => {
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : 365
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return snapshots.filter((s) => new Date(s.snapshotDate) >= cutoff)
  }, [snapshots, dateRange])

  const summary = useMemo(() => {
    if (filteredSnapshots.length === 0) return { totalSpend: 0, avgRoas: 0, avgCpm: 0, avgCtr: 0 }
    return {
      totalSpend: filteredSnapshots.reduce((s, snap) => s + Number(snap.spend), 0),
      avgRoas: filteredSnapshots.reduce((s, snap) => s + Number(snap.roas ?? 0), 0) / filteredSnapshots.length,
      avgCpm: filteredSnapshots.reduce((s, snap) => s + Number(snap.cpm), 0) / filteredSnapshots.length,
      avgCtr: filteredSnapshots.reduce((s, snap) => s + Number(snap.ctr), 0) / filteredSnapshots.length * 100,
    }
  }, [filteredSnapshots])

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
        roas: c.snapshots.reduce((s, snap) => s + Number(snap.roas ?? 0), 0) / c.snapshots.length,
      })
      const aVal = getTotals(a)[sortKey]
      const bVal = getTotals(b)[sortKey]
      return sortAsc ? aVal - bVal : bVal - aVal
    })
  }, [byCreative, sortKey, sortAsc])

  const roasChartData = useMemo(() => {
    const top5 = [...byCreative].sort((a, b) => {
      const ar = a.snapshots.reduce((s, snap) => s + Number(snap.roas ?? 0), 0) / a.snapshots.length
      const br = b.snapshots.reduce((s, snap) => s + Number(snap.roas ?? 0), 0) / b.snapshots.length
      return br - ar
    }).slice(0, 5)
    const allDates = [...new Set(filteredSnapshots.map((s) => new Date(s.snapshotDate).toISOString().split('T')[0]))].sort()
    return allDates.map((date) => {
      const point: Record<string, unknown> = { date }
      for (const creative of top5) {
        const snap = creative.snapshots.find(
          (s) => new Date(s.snapshotDate).toISOString().split('T')[0] === date
        )
        if (snap) point[creative.idea.title.slice(0, 20)] = Number(snap.roas ?? 0)
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

  const handleSync = async () => {
    setSyncing(true)
    try {
      await fetch('/api/performance/sync', { method: 'POST' })
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : 365
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      const res = await fetch(`/api/performance?from=${from}`)
      const data = await res.json()
      setSnapshots(data.snapshots)
    } finally {
      setSyncing(false)
    }
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
      className="text-left text-xs text-gray-500 dark:text-zinc-500 font-medium px-4 py-3 cursor-pointer hover:text-gray-800 dark:hover:text-zinc-300 select-none transition-colors"
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
    { label: 'Total Spend', value: `$${summary.totalSpend.toFixed(0)}`, accent: 'border-t-blue-500' },
    { label: 'Blended ROAS', value: summary.avgRoas.toFixed(2), accent: 'border-t-emerald-500' },
    { label: 'Avg CPM', value: `$${summary.avgCpm.toFixed(2)}`, accent: 'border-t-amber-500' },
    { label: 'Avg CTR', value: `${summary.avgCtr.toFixed(2)}%`, accent: 'border-t-violet-500' },
  ]

  return (
    <div className="p-6 space-y-6 animate-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Performance</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 dark:border-zinc-800 overflow-hidden text-sm">
            {['7d', '30d', '90d'].map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`px-3 py-1.5 transition-colors ${
                  dateRange === r
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-zinc-800'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-sm bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync data'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {metricCards.map((card) => (
          <div key={card.label} className={`bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 border-t-2 ${card.accent} rounded-xl p-4 shadow-sm`}>
            <p className="text-xs text-gray-500 dark:text-zinc-500 mb-1">{card.label}</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-white">{card.value}</p>
          </div>
        ))}
      </div>

      {filteredSnapshots.length > 0 ? (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-700 dark:text-zinc-300 mb-4">ROAS over time</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={roasChartData}>
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

          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-700 dark:text-zinc-300 mb-4">Spend vs Impressions (K)</h3>
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
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-12 text-center text-gray-400 dark:text-zinc-500">
          No performance data yet. Post a creative and sync to see analytics.
        </div>
      )}

      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900">
              <th className="text-left text-xs text-gray-500 dark:text-zinc-500 font-medium px-4 py-3">Creative</th>
              <SortHeader label="Impressions" col="impressions" />
              <SortHeader label="Reach" col="reach" />
              <SortHeader label="Clicks" col="clicks" />
              <SortHeader label="Spend" col="spend" />
              <SortHeader label="CPM" col="cpm" />
              <SortHeader label="CTR" col="ctr" />
              <SortHeader label="Freq" col="freq" />
              <SortHeader label="ROAS" col="roas" />
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
                roas: c.snapshots.reduce((s, snap) => s + Number(snap.roas ?? 0), 0) / c.snapshots.length,
              }
              const isFatigued = totals.freq > 3
              return (
                <>
                  <tr
                    key={c.idea.id}
                    className={`border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors ${isFatigued ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}
                    onClick={() => setExpandedPost(expandedPost === c.idea.id ? null : c.idea.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-900 dark:text-white font-medium">{c.idea.title}</span>
                        {isFatigued && (
                          <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 px-1.5 py-0.5 rounded">
                            fatigued
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">{totals.impressions.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">{totals.reach.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">{totals.clicks.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">${totals.spend.toFixed(0)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">${totals.cpm.toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">{totals.ctr.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">{totals.freq.toFixed(1)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${totals.roas >= 2 ? 'text-emerald-600 dark:text-emerald-400' : totals.roas >= 1 ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
                        {totals.roas.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 dark:text-zinc-500">
                      {expandedPost === c.idea.id ? <ChevronUp /> : <ChevronDown />}
                    </td>
                  </tr>
                  {expandedPost === c.idea.id && (
                    <tr className="border-b border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-800/30">
                      <td colSpan={10} className="px-4 py-2">
                        <div className="text-xs text-gray-500 dark:text-zinc-500 space-y-1">
                          {c.snapshots.map((s) => (
                            <div key={s.id} className="flex gap-4">
                              <span className="text-gray-400 dark:text-zinc-600">{new Date(s.snapshotDate).toLocaleDateString()}</span>
                              <span>Impressions: {s.impressions.toLocaleString()}</span>
                              <span>ROAS: {Number(s.roas ?? 0).toFixed(2)}</span>
                              <span>Freq: {Number(s.frequency).toFixed(1)}</span>
                              <span>Spend: ${Number(s.spend).toFixed(0)}</span>
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
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400 dark:text-zinc-500">No data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
