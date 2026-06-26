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

interface GenerateDrawerProps {
  open: boolean
  onClose: () => void
  onGenerated: () => void
  hasTrendContext: boolean
  onRefreshTrend: () => Promise<void>
}

export function GenerateDrawer({ open, onClose, onGenerated, hasTrendContext, onRefreshTrend }: GenerateDrawerProps) {
  const [count, setCount] = useState(5)
  const [nudge, setNudge] = useState('')
  const [funnelMode, setFunnelMode] = useState<FunnelMode>('mix')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (open) {
      setVisible(true)
      setExiting(false)
    } else if (visible && !exiting) {
      setExiting(true)
      const t = setTimeout(() => { setVisible(false); setExiting(false) }, 240)
      return () => clearTimeout(t)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

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

  if (!mounted || !visible) return null

  const buttonLabel = loading ? 'Generating...' : `Generate ${count} idea${count !== 1 ? 's' : ''}`

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      {/* Full-viewport backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 cursor-pointer ${exiting ? 'animate-fade-out-overlay' : 'animate-fade-overlay'}`}
        onClick={onClose}
      />

      {/* Drawer panel anchored to right edge */}
      <div className={`relative ml-auto w-96 bg-white border-l border-brand-border flex flex-col shadow-2xl ${exiting ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
        <div className="px-6 py-5 border-b border-brand-border flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-brand-dark">Generate Ideas</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-dark hover:bg-brand-surface transition-colors"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 px-6 py-5 space-y-5 overflow-y-auto">
          {!hasTrendContext && (
            <div className="bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-muted">
              No trend data. Ideas will be generated from your ad baseline and general EV marketing principles.
              Refresh trends on the Trends page when you want richer context.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-brand-dark mb-3">
              Number of ideas
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range" min={1} max={10} value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="flex-1 accent-indigo-500 h-1.5"
              />
              <span className="text-lg font-semibold text-brand-dark w-6 text-center tabular-nums">
                {count}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-dark mb-3">
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
                    className={`flex flex-col items-center justify-center py-2.5 px-1 rounded-lg border text-center transition-all duration-200 ${
                      active
                        ? 'bg-brand border-brand-dark text-white shadow-sm'
                        : 'bg-white border-brand-border text-brand-dark hover:border-brand'
                    }`}
                  >
                    <span className="text-sm font-semibold leading-none">{label}</span>
                    <span className={`text-[10px] mt-1 leading-none ${active ? 'text-white/70' : 'text-brand-muted'}`}>{sub}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-dark mb-2">
              Direction / nudge{' '}
              <span className="font-normal text-brand-muted">(optional)</span>
            </label>
            <textarea
              value={nudge}
              onChange={(e) => setNudge(e.target.value)}
              placeholder="e.g. focus on fleet customers, emphasize cost savings, try humor angle..."
              rows={5}
              className="w-full px-3 py-2.5 bg-white border border-brand-border rounded-lg text-sm text-brand-dark placeholder-brand-muted/60 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition-colors resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-5 border-t border-brand-border shrink-0">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full py-3 bg-brand hover:bg-brand-dark active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all duration-200 text-sm"
          >
            {buttonLabel}
          </button>
          <p className="text-xs text-center text-brand-muted mt-2">
            Press Esc or click outside to cancel
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
