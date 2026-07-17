'use client'

import { useEffect, useState, useCallback } from 'react'

type KW = { id: string; term: string }
type LensMeta = { key: string; label: string; description: string }

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`chevron-rotate ${open ? 'open' : ''} text-brand-muted`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

// Editable Google Trends keyword taxonomy. The trend job reads these from the DB, so
// edits apply on the next refresh. Trends is a weak, supplementary signal (search
// interest, not ad performance) - this just lets the marketer keep it relevant.
export function KeywordManager({ onFormatTermsChange }: { onFormatTermsChange?: (terms: string[]) => void }) {
  const [lenses, setLenses] = useState<LensMeta[]>([])
  const [groups, setGroups] = useState<Record<string, KW[]>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trends/keywords')
      if (!res.ok) { setError('Failed to load keywords'); return }
      const data = await res.json()
      setLenses(data.lenses ?? [])
      setGroups(data.groups ?? {})
      onFormatTermsChange?.(((data.groups?.format ?? []) as KW[]).map((k) => k.term))
    } catch {
      setError('Failed to load keywords')
    } finally {
      setLoading(false)
    }
  }, [onFormatTermsChange])

  useEffect(() => { load() }, [load])

  const add = async (lens: string) => {
    const term = (drafts[lens] ?? '').trim()
    if (!term) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/trends/keywords', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lens, term }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Failed to add keyword'); return }
      setDrafts((x) => ({ ...x, [lens]: '' }))
      await load()
    } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    setBusy(true); setError('')
    try {
      await fetch('/api/trends/keywords', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      })
      await load()
    } finally { setBusy(false) }
  }

  const total = Object.values(groups).reduce((n, arr) => n + arr.length, 0)

  return (
    <div className="bg-white border border-brand-border rounded-xl">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-xl">
        <div>
          <h2 className="text-sm font-semibold text-brand-dark">Trend keywords</h2>
          <p className="text-xs text-brand-muted mt-0.5">
            {loading ? 'Loading…' : `${total} keywords across ${lenses.length} lenses · edits apply on the next refresh`}
          </p>
        </div>
        <Chevron open={open} />
      </button>

      <div className={`collapsible ${open ? 'open' : ''}`}>
        <div className="collapsible-inner">
          <div className="px-5 pb-5 pt-4 border-t border-brand-border space-y-5">
            <p className="text-xs text-brand-muted">
              Google Trends is a <span className="font-medium">supplementary nudge</span> (search interest, not ad
              performance) - your Meta CPL data drives real decisions. Keep these terms relevant to what you care about.
            </p>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">{error}</div>
            )}

            {lenses.map((l) => (
              <div key={l.key}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-dark">{l.label}</h3>
                  <span className="text-[11px] text-brand-muted">{groups[l.key]?.length ?? 0}</span>
                </div>
                <p className="text-[11px] text-brand-muted mb-2">{l.description}</p>

                <div className="flex flex-wrap gap-1.5">
                  {(groups[l.key] ?? []).map((kw) => (
                    <span key={kw.id} className="inline-flex items-center gap-1 rounded-full bg-brand-surface text-brand-dark text-xs pl-2.5 pr-1.5 py-1">
                      {kw.term}
                      <button onClick={() => remove(kw.id)} disabled={busy} aria-label={`Remove ${kw.term}`} className="text-brand-muted hover:text-red-500 disabled:opacity-40 leading-none text-sm">×</button>
                    </span>
                  ))}
                  {(groups[l.key]?.length ?? 0) === 0 && (
                    <span className="text-xs text-brand-muted italic">No keywords - this lens is skipped on refresh.</span>
                  )}
                </div>

                <div className="flex gap-2 mt-2">
                  <input
                    value={drafts[l.key] ?? ''}
                    onChange={(e) => setDrafts((x) => ({ ...x, [l.key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') add(l.key) }}
                    placeholder="Add a keyword…"
                    className="flex-1 text-sm px-3 py-1.5 bg-white border border-brand-border rounded-lg text-brand-dark placeholder-brand-muted/60 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition-colors"
                  />
                  <button
                    onClick={() => add(l.key)}
                    disabled={busy || !(drafts[l.key] ?? '').trim()}
                    className="text-sm font-medium bg-brand hover:bg-brand-dark active:scale-[0.97] disabled:opacity-40 text-white px-3.5 py-1.5 rounded-lg transition-all"
                  >
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
