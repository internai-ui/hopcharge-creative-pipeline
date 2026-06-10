'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '@/components/ui/icons'

type FunnelMode = 'mix' | 'tof' | 'mof' | 'bof'

const FUNNEL_OPTIONS: { mode: FunnelMode; label: string; sub: string }[] = [
  { mode: 'mix', label: 'Mix', sub: 'All stages' },
  { mode: 'tof', label: 'TOF', sub: 'Awareness' },
  { mode: 'mof', label: 'MOF', sub: 'Consideration' },
  { mode: 'bof', label: 'BOF', sub: 'Conversion' },
]

// Must match the sidebar width (w-56 = 14rem = 224px)
const SIDEBAR_LEFT = '14rem'

interface GenerateDrawerProps {
  open: boolean
  onClose: () => void
  onGenerated: () => void
  hasTrendContext: boolean
  onRefreshTrend: () => Promise<void>
  // hasTrendContext + onRefreshTrend kept for the TrendContextPanel in IdeasClient,
  // but generation no longer requires or auto-generates trend context
}

export function GenerateDrawer({ open, onClose, onGenerated, hasTrendContext, onRefreshTrend }: GenerateDrawerProps) {
  const [count, setCount] = useState(5)
  const [nudge, setNudge] = useState('')
  const [funnelMode, setFunnelMode] = useState<FunnelMode>('mix')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/ideas/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, nudge, funnelMode }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.details ?? data.error ?? 'Generation failed')
        return
      }
      onGenerated()
      onClose()
      setNudge('')
    } catch (e) {
      setError(`Network error: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [count, nudge, hasTrendContext, onRefreshTrend, onGenerated, onClose])

  if (!mounted || !open) return null

  const buttonLabel = loading ? 'Generating...' : `Generate ${count} idea${count !== 1 ? 's' : ''}`

  return createPortal(
    <div
      className="fixed top-0 bottom-0 right-0 z-50 flex animate-fade-overlay"
      style={{ left: SIDEBAR_LEFT }}
    >
      {/* Backdrop — covers the main content area only (sidebar excluded via left offset) */}
      <div
        className="flex-1 bg-black/25 dark:bg-black/45 cursor-pointer"
        onClick={onClose}
      />

      {/* Drawer panel — anchored to right viewport edge */}
      <div className="w-96 bg-white dark:bg-zinc-900 border-l border-gray-200 dark:border-zinc-800 flex flex-col shadow-2xl animate-slide-in-right">
        <div className="px-6 py-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-gray-900 dark:text-white">Generate Ideas</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 px-6 py-5 space-y-5 overflow-y-auto">
          {!hasTrendContext && (
            <div className="bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-gray-500 dark:text-zinc-400">
              No trend data. Ideas will be generated from your ad baseline and general EV marketing principles.
              Refresh trends on the Trends page when you want richer context.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-3">
              Number of ideas
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range" min={1} max={10} value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="flex-1 accent-indigo-500 h-1.5"
              />
              <span className="text-lg font-semibold text-gray-900 dark:text-white w-6 text-center tabular-nums">
                {count}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-3">
              Funnel target
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {FUNNEL_OPTIONS.map(({ mode, label, sub }) => {
                const active = funnelMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFunnelMode(mode)}
                    className={`flex flex-col items-center justify-center py-2.5 px-1 rounded-lg border text-center transition-all duration-150 ${
                      active
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:border-indigo-400 dark:hover:border-indigo-500'
                    }`}
                  >
                    <span className="text-sm font-semibold leading-none">{label}</span>
                    <span className={`text-[10px] mt-1 leading-none ${active ? 'text-indigo-200' : 'text-gray-400 dark:text-zinc-500'}`}>{sub}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-2">
              Direction / nudge{' '}
              <span className="font-normal text-gray-400 dark:text-zinc-500">(optional)</span>
            </label>
            <textarea
              value={nudge}
              onChange={(e) => setNudge(e.target.value)}
              placeholder="e.g. focus on fleet customers, emphasize cost savings, try humor angle..."
              rows={5}
              className="w-full px-3 py-2.5 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-colors resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-5 border-t border-gray-200 dark:border-zinc-800 shrink-0">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all duration-150 text-sm"
          >
            {buttonLabel}
          </button>
          <p className="text-xs text-center text-gray-400 dark:text-zinc-600 mt-2">
            Press Esc or click outside to cancel
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
