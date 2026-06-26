'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Idea, TrendContext } from '@prisma/client'
import { IdeaCard } from './IdeaCard'
import { GenerateDrawer } from './GenerateDrawer'
import { AddIdeaDrawer } from './AddIdeaDrawer'
import { TrendContextPanel } from './TrendContextPanel'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

interface Props {
  initialIdeas: Idea[]
  latestTrend: TrendContext | null
}

function SortableIdeaCard({
  idea,
  onUpdate,
  onDelete,
  onSelectForProduction,
  onGenerateImage,
  onRegenerate,
  onRegenerateImage,
  imageGenerating,
}: {
  idea: Idea
  onUpdate: (id: string, data: Partial<Idea>) => void
  onDelete: (id: string) => void
  onSelectForProduction: (id: string) => void
  onGenerateImage: (id: string) => void
  onRegenerate: (id: string) => void
  onRegenerateImage: (id: string) => void
  imageGenerating: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idea.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <IdeaCard
        idea={idea}
        dragHandleProps={{ ...attributes, ...listeners }}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onSelectForProduction={onSelectForProduction}
        onGenerateImage={onGenerateImage}
        onRegenerate={onRegenerate}
        onRegenerateImage={onRegenerateImage}
        imageGenerating={imageGenerating}
      />
    </div>
  )
}

export function IdeasClient({ initialIdeas, latestTrend }: Props) {
  const [ideas, setIdeas] = useState<Idea[]>(initialIdeas)
  const [trendContext, setTrendContext] = useState<TrendContext | null>(latestTrend)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addDrawerOpen, setAddDrawerOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [trendFilter, setTrendFilter] = useState('')
  const [funnelFilter, setFunnelFilter] = useState('')
  const [sortBy, setSortBy] = useState('rank')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    total: number
    withLeadData: number
    successful: number
    imported: number
    errors: number
  } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<{
    total: number
    successful: number
    lastImportedAt: string | null
  } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const filteredIdeas = ideas.filter((idea) => {
    if (statusFilter && idea.status !== statusFilter) return false
    if (funnelFilter && idea.funnelStage !== funnelFilter) return false
    if (trendFilter === 'on-trend' && (idea.trendScore === null || idea.trendScore < 0.6)) return false
    if (trendFilter === 'warning' && (idea.trendScore === null || idea.trendScore < 0.3 || idea.trendScore >= 0.6)) return false
    if (trendFilter === 'stale' && (idea.trendScore === null || idea.trendScore >= 0.3)) return false
    return true
  }).sort((a, b) => {
    if (sortBy === 'performance') return (a.performanceScore ?? Infinity) - (b.performanceScore ?? Infinity) // lower CPL = better
    if (sortBy === 'trendScore') return (b.trendScore ?? 0) - (a.trendScore ?? 0)
    if (sortBy === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    return a.rank - b.rank
  })

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = ideas.findIndex((i) => i.id === active.id)
    const newIdx = ideas.findIndex((i) => i.id === over.id)
    const reordered = arrayMove(ideas, oldIdx, newIdx).map((idea, idx) => ({ ...idea, rank: idx + 1 }))
    setIdeas(reordered)

    await fetch('/api/ideas/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: reordered.map((i) => i.id) }),
    })
  }, [ideas])

  const handleUpdate = useCallback(async (id: string, data: Partial<Idea>) => {
    await fetch(`/api/ideas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, ...data } : i)))
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/ideas/${id}`, { method: 'DELETE' })
    setIdeas((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generationErrorType, setGenerationErrorType] = useState<'video' | 'image'>('video')

  const [imageGenerating, setImageGenerating] = useState<string | null>(null)

  const handleGenerateImage = useCallback(async (id: string) => {
    setGenerationError(null)
    setGenerationErrorType('image')
    setImageGenerating(id)
    try {
      const res = await fetch('/api/creatives/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: id }),
      })
      if (!res.ok) {
        const data = await res.json()
        setGenerationError(data.details ?? data.error ?? 'Image generation failed')
      } else {
        // Refresh so card shows in_production status
        const ideasRes = await fetch('/api/ideas')
        setIdeas(await ideasRes.json())
      }
    } catch (e) {
      setGenerationError(`Network error: ${String(e)}`)
    } finally {
      setImageGenerating(null)
    }
  }, [])

  const handleRegenerateImage = useCallback(async (id: string) => {
    setGenerationError(null)
    setGenerationErrorType('image')
    setImageGenerating(id)
    try {
      const res = await fetch('/api/creatives/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: id, regenerate: true }),
      })
      if (!res.ok) {
        const data = await res.json()
        setGenerationError(data.details ?? data.error ?? 'Image regeneration failed')
      } else {
        const ideasRes = await fetch('/api/ideas')
        setIdeas(await ideasRes.json())
      }
    } catch (e) {
      setGenerationError(`Network error: ${String(e)}`)
    } finally {
      setImageGenerating(null)
    }
  }, [])

  const handleRegenerate = useCallback(async (id: string) => {
    setGenerationError(null)
    setGenerationErrorType('video')
    // Reset idea to in_production so card shows the right status
    await handleUpdate(id, { status: 'in_production' as never })
    try {
      const res = await fetch('/api/creatives/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: id, regenerate: true }),
      })
      if (!res.ok) {
        const data = await res.json()
        setGenerationError(data.details ?? data.error ?? 'Regeneration failed')
      }
      const ideasRes = await fetch('/api/ideas')
      setIdeas(await ideasRes.json())
    } catch (e) {
      setGenerationError(`Network error: ${String(e)}`)
    }
  }, [handleUpdate])

  const handleSelectForProduction = useCallback(async (id: string) => {
    setGenerationError(null)
    setGenerationErrorType('video')
    await handleUpdate(id, { status: 'selected' as never })
    try {
      const res = await fetch('/api/creatives/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: id }),
      })
      if (!res.ok) {
        const data = await res.json()
        const detail = data.details ?? data.error ?? 'Video generation failed'
        setGenerationError(detail)
      }
      const ideasRes = await fetch('/api/ideas')
      setIdeas(await ideasRes.json())
    } catch (e) {
      setGenerationError(`Network error: ${String(e)}`)
    }
  }, [handleUpdate])

  const handleGenerated = useCallback(async () => {
    const res = await fetch('/api/ideas')
    const data = await res.json()
    setIdeas(data)
  }, [])

  useEffect(() => {
    fetch('/api/meta/baseline')
      .then(r => r.json())
      .then(data => setBaseline(data))
      .catch(() => {})
  }, [])

  const handleImportMeta = useCallback(async () => {
    setImporting(true)
    setImportResult(null)
    setImportError(null)
    try {
      const res = await fetch('/api/meta/import', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setImportResult(data)
        // Refresh baseline count
        fetch('/api/meta/baseline').then(r => r.json()).then(setBaseline).catch(() => {})
        const ideasRes = await fetch('/api/ideas')
        const ideasData = await ideasRes.json()
        setIdeas(ideasData)
      } else {
        setImportError(data.error ?? 'Import failed')
      }
    } catch (e) {
      setImportError(`Network error: ${String(e)}`)
    } finally {
      setImporting(false)
    }
  }, [])

  const handleRefreshTrend = useCallback(async () => {
    await fetch('/api/trends/refresh', { method: 'POST' })
    const res = await fetch('/api/trends/latest')
    if (res.ok) {
      const data = await res.json()
      setTrendContext(data)
    }
    const ideasRes = await fetch('/api/ideas')
    const ideasData = await ideasRes.json()
    setIdeas(ideasData)
  }, [])

  const selectClass = "bg-white border border-brand-border text-sm text-brand-dark px-3 py-1.5 rounded-lg focus:outline-none focus:border-brand transition-colors"

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5 animate-page">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-dark">Ideas</h1>
          <p className="text-sm text-brand-muted mt-0.5">{ideas.length} ideas · drag to reorder</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={handleImportMeta}
              disabled={importing}
              title="Pull historical Hopcharge ads from Meta and use CPL data to seed the idea generator"
              className="text-sm text-brand-muted hover:text-brand-dark border border-brand-border hover:border-brand-divider px-3 py-2 rounded-lg transition-all duration-200 disabled:opacity-50"
            >
              {importing ? 'Importing...' : 'Import Meta history'}
            </button>
            <button
              onClick={() => setAddDrawerOpen(true)}
              className="text-sm text-brand-muted hover:text-brand-dark border border-brand-border hover:border-brand-divider px-3 py-2 rounded-lg transition-all duration-200"
            >
              + Add manually
            </button>
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark active:scale-[0.97] text-white px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 shadow-sm"
            >
              + Generate ideas
            </button>
          </div>
          {baseline !== null && (
            <span className="text-xs text-right text-brand-muted">
              {baseline.total === 0 ? (
                'Idea baseline not seeded yet'
              ) : (
                <>
                  Idea baseline:{' '}
                  <span className={baseline.successful > 0 ? 'text-emerald-600 font-medium' : ''}>
                    {baseline.successful} ads under Rs100 CPL
                  </span>
                  {' '}of {baseline.total} imported
                  {baseline.lastImportedAt && (
                    <> · updated {new Date(baseline.lastImportedAt).toLocaleDateString()}</>
                  )}
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {generationError && (
        <ErrorBanner
          title={`${generationErrorType === 'image' ? 'Image' : 'Video'} generation failed`}
          message={generationError}
          onDismiss={() => setGenerationError(null)}
        />
      )}

      {importError && (
        <ErrorBanner title="Import failed" message={importError} onDismiss={() => setImportError(null)} />
      )}

      {importResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-emerald-800">
                Meta history imported successfully
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">
                Idea generator baseline updated with your proven ad concepts.
              </p>
            </div>
            <button onClick={() => setImportResult(null)} className="text-emerald-500 hover:text-emerald-700 text-xs shrink-0">Dismiss</button>
          </div>
          <div className="grid grid-cols-4 gap-3 mt-3">
            {[
              { label: 'Ads scanned', value: importResult.total },
              { label: 'With WhatsApp data', value: importResult.withLeadData },
              { label: 'CPL under Rs100', value: importResult.successful, highlight: true },
              { label: 'Errors', value: importResult.errors, warn: importResult.errors > 0 },
            ].map(({ label, value, highlight, warn }) => (
              <div key={label} className={`rounded-lg px-3 py-2 text-center ${
                highlight ? 'bg-emerald-100' :
                warn && value > 0 ? 'bg-amber-50' :
                'bg-white'
              }`}>
                <p className={`text-lg font-semibold tabular-nums ${
                  highlight ? 'text-emerald-700' :
                  warn && value > 0 ? 'text-amber-700' :
                  'text-brand-dark'
                }`}>{value}</p>
                <p className="text-xs text-brand-muted mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {importResult.successful === 0 && (
            <p className="text-xs text-amber-600 mt-3">
              No ads with CPL under Rs100 were found. The idea generator will still use your ad concepts as context, but none are marked as high-performers yet. Consider raising the threshold in .env.local (CPL_SUCCESS_THRESHOLD).
            </p>
          )}
        </div>
      )}

      <TrendContextPanel trendContext={trendContext} onRefresh={handleRefreshTrend} />

      <div className="flex items-center gap-3 flex-wrap">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="selected">Selected</option>
          <option value="in_production">In production</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>

        <select value={funnelFilter} onChange={(e) => setFunnelFilter(e.target.value)} className={selectClass}>
          <option value="">All funnel stages</option>
          <option value="TOF">TOF · awareness</option>
          <option value="MOF">MOF · consideration</option>
          <option value="BOF">BOF · conversion</option>
        </select>

        <select value={trendFilter} onChange={(e) => setTrendFilter(e.target.value)} className={selectClass}>
          <option value="">All trends</option>
          <option value="on-trend">On-trend</option>
          <option value="warning">Warning</option>
          <option value="stale">Stale</option>
        </select>

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={selectClass}>
          <option value="rank">Sort by rank</option>
          <option value="performance">Sort by CPL</option>
          <option value="trendScore">Sort by trend</option>
          <option value="created">Sort by date</option>
        </select>

        <span className="text-xs text-brand-muted ml-auto">{filteredIdeas.length} shown</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={filteredIdeas.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {filteredIdeas.length === 0 ? (
              <div className="text-center py-16 text-brand-muted">
                <p className="text-lg">No ideas yet</p>
                <p className="text-sm mt-1">Click &quot;Generate ideas&quot; to get started</p>
              </div>
            ) : (
              filteredIdeas.map((idea) => (
                <SortableIdeaCard
                  key={idea.id}
                  idea={idea}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onSelectForProduction={handleSelectForProduction}
                  onGenerateImage={handleGenerateImage}
                  onRegenerate={handleRegenerate}
                  onRegenerateImage={handleRegenerateImage}
                  imageGenerating={imageGenerating === idea.id}
                />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

      <GenerateDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onGenerated={handleGenerated}
        hasTrendContext={trendContext !== null}
        onRefreshTrend={handleRefreshTrend}
      />

      <AddIdeaDrawer
        open={addDrawerOpen}
        onClose={() => setAddDrawerOpen(false)}
        onAdded={handleGenerated}
      />
    </div>
  )
}
