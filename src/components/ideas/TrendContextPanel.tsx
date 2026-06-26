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
        className="inline-flex items-center gap-2 text-sm text-brand-muted hover:text-brand-dark border border-brand-border hover:border-brand-divider hover:bg-brand-bg px-3 py-1.5 rounded-lg transition-all duration-200"
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
    <div className="border border-brand-border rounded-xl bg-white p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-brand-dark">Trend Context</h3>
        <div className="flex items-center gap-2">
          {tc && (
            <span className="text-xs text-brand-muted">
              {new Date(tc.createdAt).toLocaleDateString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs bg-brand-surface hover:bg-brand-border text-brand-dark px-2.5 py-1 rounded transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button onClick={() => setOpen(false)} className="text-brand-muted hover:text-brand-dark transition-colors">
            <CloseIcon />
          </button>
        </div>
      </div>

      {!tc ? (
        <p className="text-sm text-brand-muted">No trend context available. Click Refresh to generate.</p>
      ) : (
        <>
          <p className="text-sm text-brand-dark leading-relaxed">{tc.summary}</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-2">Rising</h4>
              <div className="space-y-1.5">
                {(tc.risingTopics as RisingTopic[] ?? []).slice(0, 5).map((t: RisingTopic) => (
                  <div key={t.topic} className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-brand-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-[width] duration-500"
                        style={{ width: `${t.googleTrendsScore}%` }}
                      />
                    </div>
                    <span className="text-xs text-brand-dark w-32 truncate">{t.topic}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-2">Declining</h4>
              <div className="space-y-1.5">
                {(tc.decliningTopics as RisingTopic[] ?? []).slice(0, 5).map((t: RisingTopic) => (
                  <div key={t.topic} className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-brand-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500 rounded-full transition-[width] duration-500"
                        style={{ width: `${t.googleTrendsScore}%` }}
                      />
                    </div>
                    <span className="text-xs text-brand-dark w-32 truncate">{t.topic}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {tc.platformFormatTrends && (
            <div>
              <h4 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-2">Format Trends</h4>
              <div className="space-y-1">
                {(tc.platformFormatTrends as FormatTrend[]).map((f) => (
                  <div key={f.format} className="flex items-center gap-3 text-sm">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      f.trend === 'rising'   ? 'bg-emerald-50 text-emerald-700' :
                      f.trend === 'declining'? 'bg-red-50 text-red-700' :
                      'bg-brand-surface text-brand-muted'
                    }`}>{f.trend}</span>
                    <span className="text-brand-dark">{f.format}</span>
                    <span className="text-brand-muted text-xs truncate">{f.notes}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-1">Competitor Insights</h4>
            <p className="text-sm text-brand-muted">{tc.competitorAdInsights}</p>
          </div>
        </>
      )}
    </div>
  )
}
