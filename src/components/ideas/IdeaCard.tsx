'use client'

import { useState } from 'react'
import { TrendDot } from './TrendDot'
import type { Idea } from '@prisma/client'

const STATUS_COLORS: Record<string, string> = {
  pending:       'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300',
  selected:      'bg-indigo-50 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  in_production: 'bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  published:     'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  archived:      'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-500',
}

// Funnel stage: TOF (awareness) → MOF (consideration) → BOF (conversion)
const FUNNEL_META: Record<string, { color: string; label: string }> = {
  TOF: { color: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',           label: 'Top of funnel · awareness' },
  MOF: { color: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300', label: 'Middle of funnel · consideration' },
  BOF: { color: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',         label: 'Bottom of funnel · conversion' },
}

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

export function IdeaCard({ idea, dragHandleProps, onUpdate, onDelete, onSelectForProduction, onGenerateImage, onRegenerate, onRegenerateImage, imageGenerating }: IdeaCardProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<Idea>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  const renderEditableText = (field: keyof Idea, multiline = false) => {
    const value = idea[field] as string
    if (editing === field) {
      return multiline ? (
        <textarea
          autoFocus
          value={(editValues[field] as string) ?? value}
          onChange={(e) => setEditValues({ ...editValues, [field]: e.target.value })}
          onBlur={() => commitEdit(field)}
          className="w-full bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-white text-sm rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
          rows={2}
        />
      ) : (
        <input
          autoFocus
          value={(editValues[field] as string) ?? value}
          onChange={(e) => setEditValues({ ...editValues, [field]: e.target.value })}
          onBlur={() => commitEdit(field)}
          onKeyDown={(e) => e.key === 'Enter' && commitEdit(field)}
          className="w-full bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-white text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      )
    }
    return (
      <p
        className="text-sm text-gray-800 dark:text-zinc-200 cursor-text hover:bg-gray-100 dark:hover:bg-zinc-800/50 rounded px-1 -mx-1 py-0.5 transition-colors leading-relaxed"
        onClick={() => startEdit(field, value)}
      >
        {value}
      </p>
    )
  }

  return (
    <div className={`bg-white dark:bg-zinc-900 border rounded-xl transition-all duration-150 hover:-translate-y-px hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/30 ${
      isStale ? 'border-red-200 dark:border-red-900/50' : 'border-gray-200 dark:border-zinc-800'
    }`}>
      {/* ── Header row ── */}
      <div className="flex items-start gap-2 px-4 pt-4 pb-3">
        {/* Drag handle */}
        <div
          {...dragHandleProps}
          className="mt-0.5 text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-400 cursor-grab active:cursor-grabbing select-none shrink-0"
        >
          <GripIcon />
        </div>

        {/* Rank */}
        <span className="text-xs font-mono text-gray-400 dark:text-zinc-600 mt-1 shrink-0 w-6">
          #{idea.rank}
        </span>

        {/* Title — takes remaining space */}
        <div className="flex-1 min-w-0">
          {renderEditableText('title')}
        </div>

        {/* Status + actions — fixed right column */}
        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
          <div className="flex items-center gap-2">
            {idea.parentIdeaId && (
              <span className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded font-medium">
                winner
              </span>
            )}
            {idea.funnelStage && (
              <span
                title={FUNNEL_META[idea.funnelStage]?.label}
                className={`text-xs px-2 py-0.5 rounded-full font-semibold tracking-wide ${FUNNEL_META[idea.funnelStage]?.color ?? 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300'}`}
              >
                {idea.funnelStage}
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[idea.status] ?? 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300'}`}>
              {idea.status.replace('_', ' ')}
            </span>
            {idea.status === 'pending' && (
              <div className="flex gap-1">
                <button
                  onClick={() => onSelectForProduction(idea.id)}
                  title="Generate a video ad"
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 active:scale-[0.97] text-white px-2 py-1 rounded-md transition-all duration-150 font-medium whitespace-nowrap"
                >
                  Video
                </button>
                <button
                  onClick={() => onGenerateImage(idea.id)}
                  disabled={imageGenerating}
                  title="Generate a static image ad"
                  className="text-xs bg-violet-600 hover:bg-violet-500 active:scale-[0.97] disabled:opacity-60 text-white px-2 py-1 rounded-md transition-all duration-150 font-medium whitespace-nowrap"
                >
                  {imageGenerating ? '...' : 'Image'}
                </button>
              </div>
            )}
            {idea.status !== 'pending' && idea.status !== 'published' && idea.status !== 'archived' && (
              <div className="flex gap-1">
                <button
                  onClick={() => onRegenerate(idea.id)}
                  title="Scrap existing video and generate a new one"
                  className="text-xs text-gray-400 dark:text-zinc-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors whitespace-nowrap"
                >
                  ↺ Video
                </button>
                <button
                  onClick={() => onRegenerateImage(idea.id)}
                  disabled={imageGenerating}
                  title="Scrap existing image and generate a new one"
                  className="text-xs text-gray-400 dark:text-zinc-600 hover:text-violet-500 dark:hover:text-violet-400 transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  ↺ Image
                </button>
              </div>
            )}
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 text-xs">
              <button
                onClick={() => onDelete(idea.id)}
                className="text-red-500 dark:text-red-400 font-medium hover:text-red-600 transition-colors"
              >
                Confirm
              </button>
              <span className="text-gray-300 dark:text-zinc-700">·</span>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-gray-400 dark:text-zinc-600 hover:text-gray-600 dark:hover:text-zinc-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-gray-400 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Fields — two-column grid for perfect label alignment ── */}
      <div className="px-4 pb-3 grid gap-y-2" style={{ gridTemplateColumns: '3.5rem 1fr' }}>
        <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide pt-1">Hook</span>
        <div>{renderEditableText('hook', true)}</div>

        <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide pt-1">Image</span>
        <div>{renderEditableText('imageVisual', true)}</div>

        <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide pt-1">Video</span>
        <div>{renderEditableText('videoVisual', true)}</div>

        <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide pt-1">CTA</span>
        <div>{renderEditableText('cta')}</div>

        <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide pt-1">Angle</span>
        <div className="flex items-center">
          <span className="text-xs bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 px-1.5 py-0.5 rounded capitalize">
            {idea.angle.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* ── Footer — tags + trend ── */}
      {(idea.trendTags.length > 0 || idea.trendScore !== null || idea.performanceScore !== null || isStale) && (
        <div className="px-4 pb-3.5 border-t border-gray-100 dark:border-zinc-800 pt-2.5 space-y-2">
          {idea.trendTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {idea.trendTags.map((tag) => (
                <span key={tag} className="text-xs bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 px-1.5 py-0.5 rounded">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <TrendDot score={idea.trendScore} warning={idea.trendWarning} />
            {idea.performanceScore !== null && (
              <span className="text-xs text-gray-500 dark:text-zinc-400">
                ROAS <span className="font-medium text-gray-900 dark:text-white">{idea.performanceScore.toFixed(2)}</span>
              </span>
            )}
          </div>

          {isStale && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-lg px-2.5 py-1.5">
              Stale trend. Consider refreshing this idea before production.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
