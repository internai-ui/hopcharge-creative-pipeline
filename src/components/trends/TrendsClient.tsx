'use client'

import { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { TrendContext } from '@prisma/client'
import { CONTENT_FORMAT_TOPICS } from '@/lib/trend-topics'

type IdeaScore = {
  id: string; title: string; trendTags: string[]
  trendScore: number | null; trendWarning: string | null
  trendScoredAt: Date | null; status: string
}

type RisingTopic = { topic: string; rationale: string; googleTrendsScore: number }
type FormatTrend = { format: string; trend: 'rising' | 'stable' | 'declining'; notes: string }

interface TrendsClientProps {
  trendContexts: TrendContext[]
  ideaScores: IdeaScore[]
}

export function TrendsClient({ trendContexts: initialContexts, ideaScores: initialScores }: TrendsClientProps) {
  const [trendContexts, setTrendContexts] = useState<TrendContext[]>(initialContexts)
  const [ideaScores, setIdeaScores] = useState<IdeaScore[]>(initialScores)
  const [refreshing, setRefreshing] = useState<false | 'lite' | 'full'>(false)
  const [refreshError, setRefreshError] = useState('')

  const latest = trendContexts[0] as (TrendContext & {
    risingTopics: RisingTopic[]
    decliningTopics: RisingTopic[]
    platformFormatTrends: FormatTrend[]
    topicScores: Record<string, number>
  }) | undefined

  const handleRefresh = async (mode: 'lite' | 'full') => {
    setRefreshing(mode)
    setRefreshError('')
    try {
      const refreshRes = await fetch('/api/trends/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      // A failed/discarded refresh persists nothing - leave the existing history
      // untouched (don't re-add the current latest) and show why.
      if (!refreshRes.ok) {
        const data = await refreshRes.json().catch(() => ({}))
        setRefreshError(data.details ?? data.error ?? 'Refresh failed - nothing was saved.')
        return
      }
      const [contextsRes, scoresRes] = await Promise.all([
        fetch('/api/trends/latest'),
        fetch('/api/trends/idea-scores'),
      ])
      if (contextsRes.ok) {
        const ctx = await contextsRes.json()
        // Functional update - don't capture a stale `trendContexts` from closure.
        setTrendContexts((prev) => [ctx, ...prev.slice(0, 9)])
      }
      if (scoresRes.ok) setIdeaScores(await scoresRes.json())
    } finally {
      setRefreshing(false)
    }
  }

  const topTopics = useMemo(() => {
    if (!latest?.topicScores) return []
    return Object.entries(latest.topicScores)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 6)
      .map(([topic]) => topic)
  }, [latest])

  const historyChartData = useMemo(() => {
    return [...trendContexts]
      .reverse()
      .map((ctx) => {
        const scores = ctx.topicScores as Record<string, number>
        const point: Record<string, unknown> = {
          // Date + time so multiple refreshes on the same day are distinguishable.
          date: new Date(ctx.createdAt).toLocaleString([], {
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
          }),
        }
        for (const topic of topTopics) {
          point[topic] = scores[topic] !== undefined ? (scores[topic] as number) : null
        }
        return point
      })
      // Drop snapshots that predate the current topic set (old taxonomy) - they'd
      // render as empty space with nothing to hover.
      .filter((p) => topTopics.some((t) => p[t] != null))
  }, [trendContexts, topTopics])

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

  // Live content-format demand from the latest topic scores (updates every refresh),
  // ranked hottest-first. A search-interest proxy, not ad performance.
  const formatInterest = useMemo(() => {
    const scores = (latest?.topicScores ?? {}) as Record<string, number>
    return CONTENT_FORMAT_TOPICS
      .map((topic) => ({ topic, score: scores[topic] ?? 0 }))
      .sort((a, b) => b.score - a.score)
  }, [latest])

  const noTrendsData = useMemo(() => {
    if (!latest?.topicScores) return false
    return Object.values(latest.topicScores as Record<string, number>).every(s => s === 0)
  }, [latest])

  const nextRun = useMemo(() => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(6, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return next
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 animate-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-dark">Trend Intelligence</h1>
          {latest && (
            <p className="text-sm text-brand-muted mt-0.5">
              Last updated {new Date(latest.createdAt).toLocaleString()} · Next at {nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} tomorrow
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRefresh('lite')}
            disabled={!!refreshing}
            title="Google Trends only - free, no AI"
            className="border border-brand-border text-brand-dark hover:bg-brand-bg active:scale-[0.97] disabled:opacity-50 text-sm px-4 py-2 rounded-lg transition-all duration-200"
          >
            {refreshing === 'lite' ? 'Refreshing...' : 'Quick refresh (free)'}
          </button>
          <button
            onClick={() => handleRefresh('full')}
            disabled={!!refreshing}
            title="Adds live web search + competitor analysis via Claude - uses the Anthropic API"
            className="bg-brand hover:bg-brand-dark active:scale-[0.97] disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-all duration-200 shadow-sm"
          >
            {refreshing === 'full' ? 'Refreshing...' : 'Full refresh (AI)'}
          </button>
        </div>
      </div>

      {refreshError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <span>{refreshError}</span>
        </div>
      )}

      {!latest ? (
        <div className="bg-white border border-brand-border rounded-xl p-12 text-center text-brand-muted">
          No trend context yet. Click &quot;Refresh trends&quot; to generate.
        </div>
      ) : (
        <>
          <div className="bg-white border border-brand-border rounded-xl p-6 space-y-5 shadow-sm">
            <h2 className="font-semibold text-brand-dark">Current Trend Context</h2>
            <p className="text-brand-dark text-sm leading-relaxed">{latest.summary}</p>

            {noTrendsData && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <span className="shrink-0 mt-0.5">&#9888;</span>
                <span>Google Trends returned no data - the API may be rate-limited. Try again in a few minutes or use Full refresh (AI).</span>
              </div>
            )}

            {!noTrendsData && <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Rising Topics</h3>
                <div className="space-y-2.5">
                  {(latest.risingTopics ?? []).length === 0 ? (
                    <p className="text-xs text-brand-muted">No topics above threshold this period.</p>
                  ) : (latest.risingTopics ?? []).map((t: RisingTopic) => (
                    <div key={t.topic}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm text-brand-dark">{t.topic}</span>
                        <span className="text-xs text-emerald-600">{t.googleTrendsScore}</span>
                      </div>
                      <div className="h-1.5 bg-brand-surface rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-500" style={{ width: `${t.googleTrendsScore}%` }} />
                      </div>
                      <p className="text-xs text-brand-muted mt-0.5">{t.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Declining Topics</h3>
                <div className="space-y-2.5">
                  {(latest.decliningTopics ?? []).length === 0 ? (
                    <p className="text-xs text-brand-muted">No topics below threshold this period.</p>
                  ) : (latest.decliningTopics ?? []).map((t: RisingTopic) => (
                    <div key={t.topic}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm text-brand-dark">{t.topic}</span>
                        <span className="text-xs text-red-500">{t.googleTrendsScore}</span>
                      </div>
                      <div className="h-1.5 bg-brand-surface rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full transition-[width] duration-500" style={{ width: `${t.googleTrendsScore}%` }} />
                      </div>
                      <p className="text-xs text-brand-muted mt-0.5">{t.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>}

            {latest.platformFormatTrends && (
              <div>
                <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-1">Ad-Format Performance</h3>
                <p className="text-xs text-brand-muted mb-3">Which creative forms convert — from the last full refresh (or a baseline until one runs).</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-border">
                      <th className="text-left text-xs text-brand-muted font-medium py-2">Format</th>
                      <th className="text-left text-xs text-brand-muted font-medium py-2">Trend</th>
                      <th className="text-left text-xs text-brand-muted font-medium py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(latest.platformFormatTrends as FormatTrend[]).map((f) => (
                      <tr key={f.format} className="border-b border-brand-border">
                        <td className="py-2 text-brand-dark">{f.format}</td>
                        <td className="py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            f.trend === 'rising'    ? 'bg-emerald-50 text-emerald-700' :
                            f.trend === 'declining' ? 'bg-red-50 text-red-700' :
                            'bg-brand-surface text-brand-muted'
                          }`}>{f.trend}</span>
                        </td>
                        <td className="py-2 text-brand-muted text-xs">{f.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {formatInterest.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-1">Content-Format Interest</h3>
                <p className="text-xs text-brand-muted mb-3">Audience search interest in each content form (live, every refresh) — a demand signal, <span className="font-medium">not ad performance</span>.</p>
                {formatInterest.every((f) => f.score === 0) ? (
                  <p className="text-xs text-brand-muted">No data yet — run a refresh.</p>
                ) : (
                  <div className="space-y-2.5">
                    {formatInterest.map((f) => (
                      <div key={f.topic}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm text-brand-dark">{f.topic}</span>
                          <span className="text-xs text-brand-muted">{Math.round(f.score * 100)}</span>
                        </div>
                        <div className="h-1.5 bg-brand-surface rounded-full overflow-hidden">
                          <div className="h-full bg-brand rounded-full transition-[width] duration-500" style={{ width: `${Math.round(f.score * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-2">Competitor Ad Insights</h3>
              <p className="text-sm text-brand-muted">{latest.competitorAdInsights}</p>
            </div>
          </div>

          {historyChartData.length > 1 && (
            <div className="bg-white border border-brand-border rounded-xl p-6 shadow-sm">
              <h2 className="font-semibold text-brand-dark">Topic Score History</h2>
              <p className="text-xs text-brand-muted mt-0.5 mb-4">
                Relative interest (0&ndash;1) of the current top topics over recent refreshes. 1.0 = hottest in its category, so several topics can share the top line. Hover a point for exact values.
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={historyChartData} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} minTickGap={24} />
                  <YAxis domain={[0, 1]} tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }}
                    labelStyle={{ color: 'var(--chart-tooltip-label)', fontWeight: 600, marginBottom: 4 }}
                    formatter={(value, name) => [value != null ? Number(value).toFixed(2) : '—', name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                  {topTopics.map((topic, i) => (
                    <Line key={topic} type="monotone" dataKey={topic} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-brand-border">
          <h2 className="font-semibold text-brand-dark">Idea Staleness</h2>
          <p className="text-xs text-brand-muted mt-0.5">Pending/selected ideas sorted by trend score (most stale first)</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-border bg-brand-bg">
              {['Idea', 'Tags', 'Score', 'Warning', 'Status', ''].map((h) => (
                <th key={h} className="text-left text-xs text-brand-muted font-medium px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ideaScores.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-muted">No pending or selected ideas</td></tr>
            ) : ideaScores.map((idea) => (
              <tr key={idea.id} className="border-b border-brand-border hover:bg-brand-bg transition-colors">
                <td className="px-4 py-3 text-brand-dark font-medium">{idea.title}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {idea.trendTags.map((tag) => (
                      <span key={tag} className="text-xs bg-brand-surface text-brand-muted px-1.5 py-0.5 rounded">#{tag}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {idea.trendScore !== null ? (
                    <span className={`text-xs font-medium ${idea.trendScore >= 0.6 ? 'text-emerald-600' : idea.trendScore >= 0.3 ? 'text-amber-600' : 'text-red-600'}`}>
                      {Math.round(idea.trendScore * 100)}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-xs">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-brand-muted max-w-xs truncate">
                  {idea.trendWarning ?? <span className="text-gray-300">-</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-brand-surface text-brand-muted px-1.5 py-0.5 rounded">{idea.status}</span>
                </td>
                <td className="px-4 py-3">
                  <a href="/ideas" className="text-xs text-brand hover:text-indigo-500 transition-colors">View</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
