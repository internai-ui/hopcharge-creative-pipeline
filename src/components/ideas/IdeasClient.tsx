'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
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

// A generate response points at manual (copy-paste) mode when the created creative is
// parked in `awaiting_upload` (generate-image returns an array, generate a single object).
function isManualCreative(payload: unknown): boolean {
  const c = Array.isArray(payload) ? payload[0] : payload
  return !!c && typeof c === 'object' && (c as { status?: string }).status === 'awaiting_upload'
}

const MANUAL_NOTICE = 'Prompt ready. Head to Review to copy it, generate on Higgsfield, then upload the result.'

interface Props {
  initialIdeas: Idea[]
  latestTrend: TrendContext | null
  manualDefault: boolean
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

export function IdeasClient({ initialIdeas, latestTrend, manualDefault }: Props) {
  const [ideas, setIdeas] = useState<Idea[]>(initialIdeas)
  const [trendContext, setTrendContext] = useState<TrendContext | null>(latestTrend)
  // Manual (copy-paste) generation toggle - sent with every generate call so it
  // overrides the server env default per action.
  const [manualMode, setManualMode] = useState(manualDefault)
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
  const [imgImporting, setImgImporting] = useState(false)
  const [imgResult, setImgResult] = useState<{ scanned: number; matched: number; downloaded: number; skipped: number; errors: number } | null>(null)
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
  // Set when generation runs in manual (copy-paste) mode - nudges the user to Review
  // to copy the prompt and upload the media they generate on Higgsfield.
  const [genNotice, setGenNotice] = useState<string | null>(null)

  const [imageGenerating, setImageGenerating] = useState<string | null>(null)

  // Platform picker: clicking a generate button opens a Meta/YouTube chooser, and
  // the choice is passed into the generation call so the creative is built for it
  // (aspect ratio + which publisher it later goes to).
  const [pendingGen, setPendingGen] = useState<{ id: string; action: 'image' | 'regenImage' | 'video' | 'regenVideo' } | null>(null)
  const [pickerClosing, setPickerClosing] = useState(false)
  // Portal target guard - createPortal needs document, absent during SSR.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Close the picker with the same fade/scale-out the other modals use.
  const closePicker = useCallback(() => {
    setPickerClosing(true)
    setTimeout(() => { setPendingGen(null); setPickerClosing(false) }, 200)
  }, [])

  // Esc closes the picker, matching every other modal on the site.
  useEffect(() => {
    if (!pendingGen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePicker() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pendingGen, closePicker])

  const handleGenerateImage = useCallback(async (id: string, platform: string) => {
    setGenerationError(null)
    setGenerationErrorType('image')
    setGenNotice(null)
    setImageGenerating(id)
    try {
      const res = await fetch('/api/creatives/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: id, platform, manual: manualMode }),
      })
      if (!res.ok) {
        const data = await res.json()
        setGenerationError(data.details ?? data.error ?? 'Image generation failed')
      } else {
        const payload = await res.json().catch(() => null)
        if (isManualCreative(payload)) setGenNotice(MANUAL_NOTICE)
        // Refresh so card shows in_production status
        const ideasRes = await fetch('/api/ideas')
        setIdeas(await ideasRes.json())
      }
    } catch (e) {
      setGenerationError(`Network error: ${String(e)}`)
    } finally {
      setImageGenerating(null)
    }
  }, [manualMode])

  const handleRegenerateImage = useCallback(async (id: string, platform: string) => {
    setGenerationError(null)
    setGenerationErrorType('image')
    setGenNotice(null)
    setImageGenerating(id)
    try {
      const res = await fetch('/api/creatives/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: id, regenerate: true, platform, manual: manualMode }),
      })
      if (!res.ok) {
        const data = await res.json()
        setGenerationError(data.details ?? data.error ?? 'Image regeneration failed')
      } else {
        const payload = await res.json().catch(() => null)
        if (isManualCreative(payload)) setGenNotice(MANUAL_NOTICE)
        const ideasRes = await fetch('/api/ideas')
        setIdeas(await ideasRes.json())
      }
    } catch (e) {
      setGenerationError(`Network error: ${String(e)}`)
    } finally {
      setImageGenerating(null)
    }
  }, [manualMode])

  const handleRegenerate = useCallback(async (id: string, platform: string) => {
    setGenerationError(null)
    setGenerationErrorType('video')
    setGenNotice(null)
    // Reset idea to in_production so card shows the right status
    await handleUpdate(id, { status: 'in_production' as never })
    try {
      const res = await fetch('/api/creatives/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: id, regenerate: true, platform, manual: manualMode }),
      })
      if (!res.ok) {
        const data = await res.json()
        setGenerationError(data.details ?? data.error ?? 'Regeneration failed')
      } else {
        const payload = await res.json().catch(() => null)
        if (isManualCreative(payload)) setGenNotice(MANUAL_NOTICE)
      }
      const ideasRes = await fetch('/api/ideas')
      setIdeas(await ideasRes.json())
    } catch (e) {
      setGenerationError(`Network error: ${String(e)}`)
    }
  }, [handleUpdate, manualMode])

  const handleSelectForProduction = useCallback(async (id: string, platform: string) => {
    setGenerationError(null)
    setGenerationErrorType('video')
    setGenNotice(null)
    await handleUpdate(id, { status: 'selected' as never })
    try {
      const res = await fetch('/api/creatives/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: id, platform, manual: manualMode }),
      })
      if (!res.ok) {
        const data = await res.json()
        const detail = data.details ?? data.error ?? 'Video generation failed'
        setGenerationError(detail)
      } else {
        const payload = await res.json().catch(() => null)
        if (isManualCreative(payload)) setGenNotice(MANUAL_NOTICE)
      }
      const ideasRes = await fetch('/api/ideas')
      setIdeas(await ideasRes.json())
    } catch (e) {
      setGenerationError(`Network error: ${String(e)}`)
    }
  }, [handleUpdate, manualMode])

  const runPending = useCallback((platform: 'meta' | 'youtube') => {
    if (!pendingGen) return
    const { id, action } = pendingGen
    setPendingGen(null)
    if (action === 'image') handleGenerateImage(id, platform)
    else if (action === 'regenImage') handleRegenerateImage(id, platform)
    else if (action === 'video') handleSelectForProduction(id, platform)
    else handleRegenerate(id, platform)
  }, [pendingGen, handleGenerateImage, handleRegenerateImage, handleSelectForProduction, handleRegenerate])

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

  // Download the actual creative still/thumbnail for each imported historical Meta ad
  // (run "Import Meta history" first). They surface as thumbnails on the Publish page.
  const handleImportCreativeImages = useCallback(async () => {
    setImgImporting(true)
    setImgResult(null)
    setImportError(null)
    try {
      const res = await fetch('/api/meta/import-creatives', { method: 'POST' })
      const data = await res.json()
      if (res.ok) setImgResult(data)
      else setImportError(data.error ?? 'Creative image import failed')
    } catch (e) {
      setImportError(`Network error: ${String(e)}`)
    } finally {
      setImgImporting(false)
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
      {mounted && pendingGen && createPortal(
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center overlay-backdrop px-6 ${pickerClosing ? 'animate-fade-out-overlay' : 'animate-fade-overlay'}`}
          onClick={(e) => { if (e.target === e.currentTarget) closePicker() }}
        >
          <div className={`w-full max-w-sm rounded-2xl border border-brand-border bg-white p-6 text-center shadow-2xl ${pickerClosing ? 'animate-modal-out' : 'animate-modal-in'}`}>
            <h2 className="mb-1 text-base font-semibold text-brand">Generate for which platform?</h2>
            {pendingGen.action === 'image' || pendingGen.action === 'regenImage' ? (
              <>
                <p className="mb-5 text-xs text-brand-muted">Images publish to <span className="font-medium">Meta only</span>. YouTube is video-only - use <span className="font-medium">Generate video</span> for YouTube.</p>
                <div className="flex gap-3">
                  <button onClick={() => runPending('meta')} className="btn-primary flex-1">Meta</button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-5 text-xs text-brand-muted">Meta renders 9:16. YouTube renders a 9:16 Short + a 16:9 in-stream video.</p>
                <div className="flex gap-3">
                  <button onClick={() => runPending('meta')} className="btn-primary flex-1">Meta</button>
                  <button onClick={() => runPending('youtube')} className="btn-primary flex-1">YouTube</button>
                </div>
              </>
            )}
            <button onClick={closePicker} className="mt-4 text-xs text-brand-muted hover:text-brand-dark">Cancel</button>
          </div>
        </div>,
        document.body,
      )}
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
              onClick={handleImportCreativeImages}
              disabled={imgImporting}
              title="Download the actual creative still/thumbnail for each imported Meta ad (run Import Meta history first). They appear as thumbnails in the Publish page's Imported-from-Meta list."
              className="text-sm text-brand-muted hover:text-brand-dark border border-brand-border hover:border-brand-divider px-3 py-2 rounded-lg transition-all duration-200 disabled:opacity-50"
            >
              {imgImporting ? 'Importing images...' : 'Import creative images'}
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

          {/* Generation mode toggle: Auto (calls the generation API) vs Manual
              (hands you the prompt to run on Higgsfield, then you upload the result). */}
          <div className="flex items-center gap-2 text-xs">
            <span
              className="text-brand-muted cursor-help"
              title="Auto: generate via the configured API (Higgsfield/Runway/etc.). Manual: the app gives you the exact prompt to run on Higgsfield yourself, then you upload the result on the Review page."
            >
              Creative generation
            </span>
            <div className="inline-flex rounded-full border border-brand-border bg-white p-0.5">
              <button
                onClick={() => setManualMode(false)}
                className={`px-2.5 py-1 rounded-full font-medium transition-colors ${!manualMode ? 'bg-brand text-white' : 'text-brand-muted hover:text-brand-dark'}`}
              >
                Auto
              </button>
              <button
                onClick={() => setManualMode(true)}
                className={`px-2.5 py-1 rounded-full font-medium transition-colors ${manualMode ? 'bg-brand text-white' : 'text-brand-muted hover:text-brand-dark'}`}
              >
                Manual
              </button>
            </div>
          </div>
          {manualMode && (
            <span className="text-[11px] text-right text-brand-muted max-w-[15rem]">
              You&rsquo;ll get the prompt to run on Higgsfield, then upload the result in Review.
            </span>
          )}
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

      {genNotice && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-indigo-900">{genNotice}</p>
          <div className="flex items-center gap-3 shrink-0">
            <a href="/review" className="text-sm font-medium text-indigo-700 hover:text-indigo-900 underline underline-offset-2">
              Go to Review
            </a>
            <button onClick={() => setGenNotice(null)} className="text-indigo-400 hover:text-indigo-700" aria-label="Dismiss">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" /></svg>
            </button>
          </div>
        </div>
      )}

      {importError && (
        <ErrorBanner title="Import failed" message={importError} onDismiss={() => setImportError(null)} />
      )}

      {imgResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
          <p className="text-sm text-emerald-800">
            Creative images: <span className="font-semibold">{imgResult.downloaded} downloaded</span>
            {imgResult.skipped ? `, ${imgResult.skipped} already had one` : ''}
            {imgResult.errors ? `, ${imgResult.errors} errors` : ''} (of {imgResult.matched} matched, {imgResult.scanned} scanned).{' '}
            They now show in the Publish page&rsquo;s Imported-from-Meta list.
          </p>
          <button onClick={() => setImgResult(null)} className="text-emerald-500 hover:text-emerald-700 text-xs shrink-0">Dismiss</button>
        </div>
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
                  onSelectForProduction={(id) => setPendingGen({ id, action: 'video' })}
                  onGenerateImage={(id) => setPendingGen({ id, action: 'image' })}
                  onRegenerate={(id) => setPendingGen({ id, action: 'regenVideo' })}
                  onRegenerateImage={(id) => setPendingGen({ id, action: 'regenImage' })}
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
