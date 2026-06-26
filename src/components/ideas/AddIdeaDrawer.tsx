'use client'

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '@/components/ui/icons'

// Stable no-op subscribe for useSyncExternalStore-based client detection.
const emptySubscribe = () => () => {}

const ANGLES = [
  'pain_point', 'social_proof', 'curiosity_gap', 'lifestyle',
  'education', 'values', 'convenience', 'problem_solution', 'discovery',
]

interface AddIdeaDrawerProps {
  open: boolean
  onClose: () => void
  onAdded: () => void
}

const EMPTY = { title: '', hook: '', imageVisual: '', videoVisual: '', videoFirstFrame: '', cta: '', primaryText: '', headline: '', angle: 'pain_point', trendTags: '' }

export function AddIdeaDrawer({ open, onClose, onAdded }: AddIdeaDrawerProps) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [render, setRender] = useState(open)
  const [exiting, setExiting] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)

  // Client-only flag for the portal (the panel renders into document.body) without
  // a set-state-in-effect: server snapshot is false, client snapshot true.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  // Drive the enter/exit animation by adjusting state during render when the `open`
  // prop flips - React's sanctioned alternative to syncing props via an effect.
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setRender(true)
      setExiting(false)
    } else if (render) {
      setExiting(true)
    }
  }

  // The only async piece: unmount after the exit animation finishes. setState lives
  // inside the timeout callback, not synchronously in the effect body.
  useEffect(() => {
    if (!exiting) return
    const t = setTimeout(() => { setRender(false); setExiting(false) }, 240)
    return () => clearTimeout(t)
  }, [exiting])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSave = useCallback(async () => {
    if (!form.title.trim() || !form.hook.trim() || !form.imageVisual.trim() || !form.videoVisual.trim() || !form.cta.trim() || !form.primaryText.trim() || !form.headline.trim()) {
      setError('Title, hook, image visual, video visual, CTA, primary text, and headline are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          trendTags: form.trendTags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        return
      }
      onAdded()
      onClose()
      setForm(EMPTY)
    } catch (e) {
      setError(`Network error: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }, [form, onAdded, onClose])

  if (!mounted || !render) return null

  const inputCls = 'w-full px-3 py-2 bg-white border border-brand-border rounded-lg text-sm text-brand-dark placeholder-brand-muted/60 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition-colors'
  const labelCls = 'block text-sm font-medium text-brand-dark mb-1.5'

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      {/* Full-viewport backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 cursor-pointer ${exiting ? 'animate-fade-out-overlay' : 'animate-fade-overlay'}`}
        onClick={onClose}
      />

      {/* Drawer panel anchored to right edge */}
      <div className={`relative ml-auto w-[480px] bg-white border-l border-brand-border flex flex-col shadow-2xl ${exiting ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
        <div className="px-6 py-5 border-b border-brand-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-brand-dark">Add idea manually</h2>
            <p className="text-xs text-brand-muted mt-0.5">Paste in an idea from Claude chat or write your own</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-dark hover:bg-brand-surface transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 px-6 py-5 space-y-4 overflow-y-auto">
          <div>
            <label className={labelCls}>Title <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={set('title')}
              placeholder="e.g. The 10-Minute Charge"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              Hook <span className="text-red-400">*</span>
              <span className="text-brand-muted font-normal ml-1">- opening line / first 3 seconds</span>
            </label>
            <textarea
              value={form.hook}
              onChange={set('hook')}
              placeholder="e.g. Most EV owners in Delhi don't have a home charger. Here's how we fixed that."
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <label className={labelCls}>
              Image visual <span className="text-red-400">*</span>
              <span className="text-brand-muted font-normal ml-1">- single decisive moment for the still ad</span>
            </label>
            <textarea
              value={form.imageVisual}
              onChange={set('imageVisual')}
              placeholder="e.g. Close-up of charging connector clicking into Tata Nexon EV at dusk, apartment block in background"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <label className={labelCls}>
              Video visual <span className="text-red-400">*</span>
              <span className="text-brand-muted font-normal ml-1">- scene sequence for the video ad</span>
            </label>
            <textarea
              value={form.videoVisual}
              onChange={set('videoVisual')}
              placeholder="e.g. Van pulls into colony gate → owner walks out → cable connects → time-lapse charge fills to 100%"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <label className={labelCls}>
              Video first frame
              <span className="text-brand-muted font-normal ml-1">- still for the video&rsquo;s opening shot (0&ndash;3s); leave blank to auto-derive from the video visual</span>
            </label>
            <textarea
              value={form.videoFirstFrame}
              onChange={set('videoFirstFrame')}
              placeholder="e.g. Wide establishing still: Sara stepping out of her white Tata Punch EV in a Gurugram driveway at golden hour, van parked behind, calm expression"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <label className={labelCls}>CTA <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={form.cta}
              onChange={set('cta')}
              placeholder="e.g. Book a free home charger consultation"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              Primary text <span className="text-red-400">*</span>
              <span className="text-brand-muted font-normal ml-1">- ad body shown above the creative</span>
            </label>
            <textarea
              value={form.primaryText}
              onChange={set('primaryText')}
              placeholder="e.g. No home charger? We bring the charge to your door. WhatsApp us to book your first slot."
              rows={3}
              className={`${inputCls} resize-none`}
            />
            <p className="text-xs text-brand-muted mt-1">All ads run a &ldquo;Send WhatsApp Message&rdquo; button - make the copy lead to a chat.</p>
          </div>

          <div>
            <label className={labelCls}>
              Headline <span className="text-red-400">*</span>
              <span className="text-brand-muted font-normal ml-1">- bold line beneath the creative (~40 chars)</span>
            </label>
            <input
              type="text"
              value={form.headline}
              onChange={set('headline')}
              placeholder="e.g. Charging, at your doorstep"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Angle</label>
            <select value={form.angle} onChange={set('angle')} className={inputCls}>
              {ANGLES.map(a => (
                <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>
              Trend tags
              <span className="text-brand-muted font-normal ml-1">- comma separated</span>
            </label>
            <input
              type="text"
              value={form.trendTags}
              onChange={set('trendTags')}
              placeholder="e.g. home_charging, ev_lifestyle, convenience"
              className={inputCls}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-5 border-t border-brand-border shrink-0 space-y-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 bg-brand hover:bg-brand-dark active:scale-[0.98] disabled:opacity-60 text-white rounded-xl font-medium text-sm transition-all duration-200"
          >
            {saving ? 'Saving...' : 'Add idea'}
          </button>
          <p className="text-xs text-center text-brand-muted">
            Press Esc or click outside to cancel
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
