'use client'

import { useState } from 'react'
import type { TrendContext } from '@prisma/client'
import { CloseIcon } from '@/components/ui/icons'

interface TrendContextPanelProps {
  trendContext: TrendContext | null
  onRefresh: () => void
}

type RisingTopic = { topic: string; rationale: string; googleTrendsScore: number }
type FormatTrend = { format: string; trend: 'rising' | 'stable' | 'declining'; notes: string }

function TrendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  )
}

export function TrendContextPanel({ trendContext, onRefresh }: TrendContextPanelProps) {
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800/50 px-3 py-1.5 rounded-lg transition-all duration-150"
      >
        <TrendIcon />
        Trend Context
      </button>
    )
  }

  const tc = trendContext as (TrendContext & {
    risingTopics: RisingTopic[]
    decliningTopics: RisingTopic[]
    platformFormatTrends: FormatTrend[]
  }) | null

  return (
    <div className="border border-gray-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Trend Context</h3>
        <div className="flex items-center gap-2">
          {tc && (
            <span className="text-xs text-gray-400 dark:text-zinc-500">
              {new Date(tc.createdAt).toLocaleDateString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300 px-2.5 py-1 rounded transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button onClick={() => setOpen(false)} className="text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-white transition-colors">
            <CloseIcon />
          </button>
        </div>
      </div>

      {!tc ? (
        <p className="text-sm text-gray-500 dark:text-zinc-500">No trend context available. Click Refresh to generate.</p>
      ) : (
        <>
          <p className="text-sm text-gray-700 dark:text-zinc-300 leading-relaxed">{tc.summary}</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-2">Rising</h4>
              <div className="space-y-1.5">
                {(tc.risingTopics as RisingTopic[] ?? []).slice(0, 5).map((t: RisingTopic) => (
                  <div key={t.topic} className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-[width] duration-500"
                        style={{ width: `${t.googleTrendsScore}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-700 dark:text-zinc-300 w-32 truncate">{t.topic}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-2">Declining</h4>
              <div className="space-y-1.5">
                {(tc.decliningTopics as RisingTopic[] ?? []).slice(0, 5).map((t: RisingTopic) => (
                  <div key={t.topic} className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500 rounded-full transition-[width] duration-500"
                        style={{ width: `${t.googleTrendsScore}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-700 dark:text-zinc-300 w-32 truncate">{t.topic}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {tc.platformFormatTrends && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-2">Format Trends</h4>
              <div className="space-y-1">
                {(tc.platformFormatTrends as FormatTrend[]).map((f) => (
                  <div key={f.format} className="flex items-center gap-3 text-sm">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      f.trend === 'rising'   ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' :
                      f.trend === 'declining'? 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300' :
                      'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}>{f.trend}</span>
                    <span className="text-gray-700 dark:text-zinc-300">{f.format}</span>
                    <span className="text-gray-400 dark:text-zinc-500 text-xs truncate">{f.notes}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">Competitor Insights</h4>
            <p className="text-sm text-gray-600 dark:text-zinc-400">{tc.competitorAdInsights}</p>
          </div>
        </>
      )}
    </div>
  )
}
