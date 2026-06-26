'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { TrendDot } from './TrendDot'
import type { Idea } from '@prisma/client'

const STATUS_COLORS: Record<string, string> = {
  pending:       'bg-brand-surface text-brand-muted',
  selected:      'bg-brand-surface text-brand',
  in_production: 'bg-amber-50 text-amber-700',
  published:     'bg-emerald-50 text-emerald-700',
  archived:      'bg-brand-surface text-brand-muted',
}

const FUNNEL_META: Record<string, { color: string; dot: string; sublabel: string }> = {
  TOF: { color: 'bg-sky-50 text-sky-700',         dot: 'bg-sky-400',      sublabel: 'Awareness' },
  MOF: { color: 'bg-violet-50 text-violet-700',   dot: 'bg-violet-500',   sublabel: 'Consideration' },
  BOF: { color: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500',  sublabel: 'Conversion' },
}

const FUNNEL_DROPDOWN = [
  { value: 'TOF', label: 'TOF', sublabel: 'Awareness',     dot: 'bg-sky-400' },
  { value: 'MOF', label: 'MOF', sublabel: 'Consideration', dot: 'bg-violet-500' },
  { value: 'BOF', label: 'BOF', sublabel: 'Conversion',    dot: 'bg-emerald-500' },
]

const ANGLES = [
  'pain_point', 'social_proof', 'curiosity_gap', 'lifestyle',
  'education', 'values', 'convenience', 'problem_solution', 'discovery',
]

const ANGLE_DROPDOWN = ANGLES.map(a => ({ value: a, label: a.replace(/_/g, ' ') }))

// ── Floating dropdown menu ─────────────────────────────────────────────────

interface MenuOption {
  value: string
  label: string
  sublabel?: string
  dot?: string
}

function FloatingMenu({
  anchorEl,
  options,
  value,
  onSelect,
  onClose,
}: {
  anchorEl: HTMLElement
  options: MenuOption[]
  value: string
  onSelect: (v: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<React.CSSProperties>({ top: -9999, left: -9999, opacity: 0 })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const place = () => {
      const rect = anchorEl.getBoundingClientRect()
      const panelW = 192
      const left = Math.min(rect.left, window.innerWidth - panelW - 8)
      const spaceBelow = window.innerHeight - rect.bottom
      const above = spaceBelow < options.length * 42 + 16
      setPos(above
        ? { bottom: window.innerHeight - rect.top + 6, left, minWidth: panelW }
        : { top: rect.bottom + 6, left, minWidth: panelW }
      )
    }
    place()
    requestAnimationFrame(() => setReady(true))

    const close = () => onClose()
    window.addEventListener('scroll', close, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [anchorEl, options.length, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && e.target !== anchorEl) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [anchorEl, onClose])

  return createPortal(
    <div
      ref={ref}
      style={{ ...pos, position: 'fixed', zIndex: 9999 }}
      className={`bg-white border border-brand-border rounded-xl shadow-xl shadow-brand-darker/10 py-1.5 transition-[opacity,transform] duration-150 origin-top-left ${
        ready ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}
    >
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onPointerDown={e => { e.preventDefault(); onSelect(opt.value); onClose() }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-brand-surface ${
              active ? 'text-brand' : 'text-brand-dark'
            }`}
          >
            {opt.dot && (
              <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />
            )}
            <span className={`text-sm flex-1 capitalize ${active ? 'font-semibold' : ''}`}>
              {opt.label}
            </span>
            {opt.sublabel && (
              <span className="text-xs text-brand-muted shrink-0">{opt.sublabel}</span>
            )}
            <span className={`shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 6.5 4.5 9 10 3"/>
              </svg>
            </span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}

// ── IdeaCard ───────────────────────────────────────────────────────────────

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
      <circle cx="2" cy="2"  r="1.5"/>
      <circle cx="8" cy="2"  r="1.5"/>
      <circle cx="2" cy="8"  r="1.5"/>
      <circle cx="8" cy="8"  r="1.5"/>
      <circle cx="2" cy="14" r="1.5"/>
      <circle cx="8" cy="14" r="1.5"/>
    </svg>
  )
}

interface IdeaCardProps {
  idea: Idea
  dragHandleProps?: Record<string, unknown>
  onUpdate: (id: string, data: Partial<Idea>) => void
  onDelete: (id: string) => void
  onSelectForProduction: (id: string) => void
  onGenerateImage: (id: string) => void
  onRegenerate: (id: string) => void
  onRegenerateImage: (id: string) => void
  imageGenerating?: boolean
}

export function IdeaCard({
  idea, dragHandleProps, onUpdate, onDelete,
  onSelectForProduction, onGenerateImage,
  onRegenerate, onRegenerateImage, imageGenerating,
}: IdeaCardProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<Idea>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  const funnelRef = useRef<HTMLSpanElement>(null)
  const angleRef  = useRef<HTMLSpanElement>(null)

  const isStale = idea.trendScore !== null && idea.trendScore < 0.3

  const startEdit = (field: string, value: unknown) => {
    setEditing(field)
    setEditValues({ [field]: value })
  }

  const commitEdit = async (field: string) => {
    if (editValues[field as keyof Idea] === idea[field as keyof Idea]) { setEditing(null); return }
    await onUpdate(idea.id, { [field]: editValues[field as keyof Idea] })
    setEditing(null)
  }

  const commitSelect = async (field: keyof Idea, value: string) => {
    if (value !== (idea[field] as string)) await onUpdate(idea.id, { [field]: value })
    setEditing(null)
  }

  const commitTags = async (raw: string) => {
    const tags = raw.split(',').map(t => t.trim()).filter(Boolean)
    if (JSON.stringify(tags) !== JSON.stringify(idea.trendTags)) {
      await onUpdate(idea.id, { trendTags: tags })
    }
    setEditing(null)
  }

  const renderEditableText = (field: keyof Idea, multiline = false) => {
    const value = (idea[field] as string | null) ?? ''
    if (editing === field) {
      const shared = {
        autoFocus: true,
        value: (editValues[field] as string) ?? value,
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          setEditValues({ ...editValues, [field]: e.target.value }),
        onBlur: () => commitEdit(field),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Escape') setEditing(null)
          if (!multiline && e.key === 'Enter') commitEdit(field)
        },
        className: 'w-full bg-brand-surface text-brand-dark text-sm rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-brand/20 focus:bg-white transition-colors',
      }
      return multiline
        ? <textarea {...shared} rows={2} />
        : <input {...(shared as React.InputHTMLAttributes<HTMLInputElement>)} />
    }
    return (
      <p
        className="text-sm text-brand-dark cursor-text hover:bg-brand-surface rounded-lg px-2 -mx-2 py-1 transition-colors leading-relaxed"
        onClick={() => startEdit(field, value)}
      >
        {value}
      </p>
    )
  }

  return (
    <div className={`bg-white border rounded-xl transition-all duration-200 hover:-translate-y-px hover:shadow-md hover:shadow-black/5 ${
      isStale ? 'border-red-200' : 'border-brand-border'
    }`}>

      {/* ── Header ── */}
      <div className="flex items-start gap-2 px-4 pt-4 pb-3">
        <div
          {...dragHandleProps}
          suppressHydrationWarning
          className="mt-0.5 text-gray-300 hover:text-brand-muted cursor-grab active:cursor-grabbing select-none shrink-0"
        >
          <GripIcon />
        </div>

        <span className="text-xs font-mono text-brand-muted mt-1 shrink-0 w-6">
          #{idea.rank}
        </span>

        <div className="flex-1 min-w-0">
          {renderEditableText('title')}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {idea.parentIdeaId && (
              <span className="text-xs text-brand bg-brand-surface px-1.5 py-0.5 rounded font-medium">
                winner
              </span>
            )}

            {/* Funnel stage - custom dropdown trigger */}
            {idea.funnelStage && (
              <span
                ref={funnelRef}
                onClick={() => setEditing(editing === 'funnelStage' ? null : 'funnelStage')}
                className={`text-xs px-2 py-0.5 rounded-full font-semibold tracking-wide cursor-pointer select-none hover:opacity-80 active:scale-95 transition-all ${
                  FUNNEL_META[idea.funnelStage]?.color ?? 'bg-brand-surface text-brand-muted'
                }`}
              >
                {idea.funnelStage}
              </span>
            )}

            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[idea.status] ?? 'bg-brand-surface text-brand-muted'}`}>
              {idea.status.replace('_', ' ')}
            </span>

            {idea.status === 'pending' && (
              <div className="flex gap-1">
                <button
                  onClick={() => onSelectForProduction(idea.id)}
                  className="text-xs bg-brand hover:bg-brand-dark active:scale-[0.97] text-white px-2 py-1 rounded-md transition-all duration-200 font-medium whitespace-nowrap"
                >
                  Video
                </button>
                <button
                  onClick={() => onGenerateImage(idea.id)}
                  disabled={imageGenerating}
                  className="text-xs bg-brand-accent hover:bg-brand-accent/85 active:scale-[0.97] disabled:opacity-60 text-white px-2 py-1 rounded-md transition-all duration-200 font-medium whitespace-nowrap"
                >
                  {imageGenerating ? '...' : 'Image'}
                </button>
              </div>
            )}
            {idea.status !== 'pending' && idea.status !== 'published' && idea.status !== 'archived' && (
              <div className="flex gap-1">
                <button onClick={() => onRegenerate(idea.id)} className="text-xs text-brand-muted hover:text-brand transition-colors whitespace-nowrap">
                  ↺ Video
                </button>
                <button onClick={() => onRegenerateImage(idea.id)} disabled={imageGenerating} className="text-xs text-brand-muted hover:text-brand-accent transition-colors whitespace-nowrap disabled:opacity-50">
                  ↺ Image
                </button>
              </div>
            )}
          </div>

          {confirmDelete ? (
            <div className="flex items-center gap-1.5 text-xs">
              <button onClick={() => onDelete(idea.id)} className="text-red-500 font-medium hover:text-red-600 transition-colors">Confirm</button>
              <span className="text-gray-300">·</span>
              <button onClick={() => setConfirmDelete(false)} className="text-brand-muted hover:text-brand-dark transition-colors">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-brand-muted hover:text-red-500 transition-colors">
              Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Fields ── */}
      <div className="px-4 pb-3 grid gap-y-2" style={{ gridTemplateColumns: '4.75rem 1fr' }}>
        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide pt-1">Hook</span>
        <div>{renderEditableText('hook', true)}</div>

        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide pt-1">Image</span>
        <div>{renderEditableText('imageVisual', true)}</div>

        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide pt-1">Video</span>
        <div>{renderEditableText('videoVisual', true)}</div>

        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide pt-1" title="Still for the video's opening frame (image2video first frame)">Frame 1</span>
        <div>{renderEditableText('videoFirstFrame', true)}</div>

        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide pt-1">CTA</span>
        <div>{renderEditableText('cta')}</div>

        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide pt-1">Primary</span>
        <div>{renderEditableText('primaryText', true)}</div>

        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide pt-1">Headline</span>
        <div>{renderEditableText('headline')}</div>

        {/* Angle - custom dropdown trigger */}
        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide pt-1">Angle</span>
        <div className="flex items-center">
          <span
            ref={angleRef}
            onClick={() => setEditing(editing === 'angle' ? null : 'angle')}
            className="text-xs bg-brand-surface text-brand-muted px-2 py-0.5 rounded-md capitalize cursor-pointer select-none hover:bg-brand-border hover:text-brand-dark active:scale-95 transition-all"
          >
            {idea.angle.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="px-4 pb-3.5 border-t border-brand-border pt-2.5 space-y-2">
        {/* Trend tags */}
        {editing === 'trendTags' ? (
          <input
            autoFocus
            type="text"
            defaultValue={idea.trendTags.join(', ')}
            onBlur={e => commitTags(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditing(null)
            }}
            placeholder="tag1, tag2, tag3"
            className="w-full bg-brand-surface text-brand-dark text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:bg-white transition-colors"
          />
        ) : idea.trendTags.length > 0 ? (
          <div
            className="flex flex-wrap gap-1 cursor-text group"
            onClick={() => setEditing('trendTags')}
          >
            {idea.trendTags.map(tag => (
              <span key={tag} className="text-xs bg-brand-surface text-brand-muted px-1.5 py-0.5 rounded group-hover:bg-brand-border transition-colors">
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setEditing('trendTags')}
            className="text-xs text-brand-muted/40 hover:text-brand-muted transition-colors"
          >
            + add tags
          </button>
        )}

        <div className="flex items-center justify-between">
          <TrendDot score={idea.trendScore} warning={idea.trendWarning} />
          {idea.performanceScore !== null && (
            <span className="text-xs text-brand-muted">
              CPL <span className="font-medium text-brand-dark">₹{idea.performanceScore.toFixed(0)}</span>
            </span>
          )}
        </div>

        {isStale && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
            Stale trend. Consider refreshing this idea before production.
          </p>
        )}
      </div>

      {/* ── Floating dropdowns ── */}
      {editing === 'funnelStage' && funnelRef.current && (
        <FloatingMenu
          anchorEl={funnelRef.current}
          options={FUNNEL_DROPDOWN}
          value={idea.funnelStage ?? ''}
          onSelect={v => commitSelect('funnelStage', v)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing === 'angle' && angleRef.current && (
        <FloatingMenu
          anchorEl={angleRef.current}
          options={ANGLE_DROPDOWN}
          value={idea.angle}
          onSelect={v => commitSelect('angle', v)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
