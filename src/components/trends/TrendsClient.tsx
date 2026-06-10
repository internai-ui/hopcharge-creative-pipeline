'use client'

import { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { TrendContext } from '@prisma/client'

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
  const [refreshing, setRefreshing] = useState(false)

  const latest = trendContexts[0] as (TrendContext & {
    risingTopics: RisingTopic[]
    decliningTopics: RisingTopic[]
    platformFormatTrends: FormatTrend[]
    topicScores: Record<string, number>
  }) | undefined

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetch('/api/trends/refresh', { method: 'POST' })
      const [contextsRes, scoresRes] = await Promise.all([
        fetch('/api/trends/latest'),
        fetch('/api/trends/idea-scores'),
      ])
      if (contextsRes.ok) {
        const ctx = await contextsRes.json()
        setTrendContexts([ctx, ...trendContexts.slice(0, 9)])
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
    return [...trendContexts].reverse().map((ctx) => {
      const scores = ctx.topicScores as Record<string, number>
      const point: Record<string, unknown> = {
        date: new Date(ctx.createdAt).toLocaleDateString(),
      }
      for (const topic of topTopics) {
        point[topic] = scores[topic] !== undefined ? (scores[topic] as number) : null
      }
      return point
    })
  }, [trendContexts, topTopics])

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

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
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Trend Intelligence</h1>
          {latest && (
            <p className="text-sm text-gray-400 dark:text-zinc-500 mt-0.5">
              Last updated {new Date(latest.createdAt).toLocaleString()} · Next at {nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} tomorrow
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="bg-indigo-600 hover:bg-indigo-500 active:scale-[0.97] disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-all duration-150 shadow-sm"
        >
          {refreshing ? 'Refreshing...' : 'Refresh trends'}
        </button>
      </div>

      {!latest ? (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-12 text-center text-gray-400 dark:text-zinc-500">
          No trend context yet. Click &quot;Refresh trends&quot; to generate.
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-6 space-y-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 dark:text-white">Current Trend Context</h2>
            <p className="text-gray-700 dark:text-zinc-300 text-sm leading-relaxed">{latest.summary}</p>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-3">Rising Topics</h3>
                <div className="space-y-2.5">
                  {(latest.risingTopics ?? []).map((t: RisingTopic) => (
                    <div key={t.topic}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm text-gray-900 dark:text-white">{t.topic}</span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">{t.googleTrendsScore}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-500" style={{ width: `${t.googleTrendsScore}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-zinc-600 mt-0.5">{t.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-3">Declining Topics</h3>
                <div className="space-y-2.5">
                  {(latest.decliningTopics ?? []).map((t: RisingTopic) => (
                    <div key={t.topic}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm text-gray-900 dark:text-white">{t.topic}</span>
                        <span className="text-xs text-red-500 dark:text-red-400">{t.googleTrendsScore}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full transition-[width] duration-500" style={{ width: `${t.googleTrendsScore}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-zinc-600 mt-0.5">{t.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {latest.platformFormatTrends && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-3">Platform Format Trends</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-zinc-800">
                      <th className="text-left text-xs text-gray-500 dark:text-zinc-500 font-medium py-2">Format</th>
                      <th className="text-left text-xs text-gray-500 dark:text-zinc-500 font-medium py-2">Trend</th>
                      <th className="text-left text-xs text-gray-500 dark:text-zinc-500 font-medium py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(latest.platformFormatTrends as FormatTrend[]).map((f) => (
                      <tr key={f.format} className="border-b border-gray-100 dark:border-zinc-800/50">
                        <td className="py-2 text-gray-700 dark:text-zinc-300">{f.format}</td>
                        <td className="py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            f.trend === 'rising'    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' :
                            f.trend === 'declining' ? 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300' :
                            'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}>{f.trend}</span>
                        </td>
                        <td className="py-2 text-gray-400 dark:text-zinc-500 text-xs">{f.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-2">Competitor Ad Insights</h3>
              <p className="text-sm text-gray-600 dark:text-zinc-400">{latest.competitorAdInsights}</p>
            </div>
          </div>

          {historyChartData.length > 1 && (
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Topic Score History</h2>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={historyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} />
                  <YAxis domain={[0, 1]} tick={{ fill: 'var(--chart-tick)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }}
                  />
                  {topTopics.map((topic, i) => (
                    <Line key={topic} type="monotone" dataKey={topic} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={true} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">Idea Staleness</h2>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Pending/selected ideas sorted by trend score (most stale first)</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900">
              {['Idea', 'Tags', 'Score', 'Warning', 'Status', ''].map((h) => (
                <th key={h} className="text-left text-xs text-gray-500 dark:text-zinc-500 font-medium px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ideaScores.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-zinc-500">No pending or selected ideas</td></tr>
            ) : ideaScores.map((idea) => (
              <tr key={idea.id} className="border-b border-gray-100 dark:border-zinc-800/50 hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{idea.title}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {idea.trendTags.map((tag) => (
                      <span key={tag} className="text-xs bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 px-1.5 py-0.5 rounded">#{tag}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {idea.trendScore !== null ? (
                    <span className={`text-xs font-medium ${idea.trendScore >= 0.6 ? 'text-emerald-600 dark:text-emerald-400' : idea.trendScore >= 0.3 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                      {Math.round(idea.trendScore * 100)}
                    </span>
                  ) : (
                    <span className="text-gray-300 dark:text-zinc-600 text-xs">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 dark:text-zinc-500 max-w-xs truncate">
                  {idea.trendWarning ?? <span className="text-gray-300 dark:text-zinc-600">-</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 px-1.5 py-0.5 rounded">{idea.status}</span>
                </td>
                <td className="px-4 py-3">
                  <a href="/ideas" className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors">View</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
