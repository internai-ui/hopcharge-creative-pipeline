'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '@/components/ui/icons'

const SIDEBAR_LEFT = '14rem'

const ANGLES = [
  'pain_point', 'social_proof', 'curiosity_gap', 'lifestyle',
  'education', 'values', 'convenience', 'problem_solution', 'discovery',
]

interface AddIdeaDrawerProps {
  open: boolean
  onClose: () => void
  onAdded: () => void
}

const EMPTY = { title: '', hook: '', imageVisual: '', videoVisual: '', cta: '', angle: 'pain_point', trendTags: '' }

export function AddIdeaDrawer({ open, onClose, onAdded }: AddIdeaDrawerProps) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSave = useCallback(async () => {
    if (!form.title.trim() || !form.hook.trim() || !form.imageVisual.trim() || !form.videoVisual.trim() || !form.cta.trim()) {
      setError('Title, hook, image visual, video visual, and CTA are required.')
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

  if (!mounted || !open) return null

  const inputCls = 'w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-colors'
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1.5'

  return createPortal(
    <div
      className="fixed top-0 bottom-0 right-0 z-50 flex animate-fade-overlay"
      style={{ left: SIDEBAR_LEFT }}
    >
      <div className="flex-1 bg-black/25 dark:bg-black/45 cursor-pointer" onClick={onClose} />

      <div className="w-[480px] bg-white dark:bg-zinc-900 border-l border-gray-200 dark:border-zinc-800 flex flex-col shadow-2xl animate-slide-in-right">
        <div className="px-6 py-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Add idea manually</h2>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Paste in an idea from Claude chat or write your own</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
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
              <span className="text-gray-400 dark:text-zinc-500 font-normal ml-1">— opening line / first 3 seconds</span>
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
              <span className="text-gray-400 dark:text-zinc-500 font-normal ml-1">— single decisive moment for the still ad</span>
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
              <span className="text-gray-400 dark:text-zinc-500 font-normal ml-1">— scene sequence for the video ad</span>
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
              <span className="text-gray-400 dark:text-zinc-500 font-normal ml-1">— comma separated</span>
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
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-5 border-t border-gray-200 dark:border-zinc-800 shrink-0 space-y-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-60 text-white rounded-xl font-medium text-sm transition-all duration-150"
          >
            {saving ? 'Saving...' : 'Add idea'}
          </button>
          <p className="text-xs text-center text-gray-400 dark:text-zinc-600">
            Press Esc or click outside to cancel
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
