'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Creative, Idea } from '@prisma/client'
import { TrendDot } from '@/components/ideas/TrendDot'

type CreativeWithIdea = Creative & { idea: Idea }

const STATUS_META: Record<string, { label: string; chip: string; dot: string }> = {
  generating:       { label: 'Generating',  chip: 'bg-amber-50 text-amber-700 ring-amber-600/20',     dot: 'bg-amber-500' },
  ready_for_review: { label: 'For review',   chip: 'bg-blue-50 text-blue-700 ring-blue-600/20',        dot: 'bg-blue-500' },
  approved:         { label: 'Approved',     chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  rejected:         { label: 'Rejected',     chip: 'bg-red-50 text-red-600 ring-red-600/20',           dot: 'bg-red-500' },
  published:        { label: 'Published',    chip: 'bg-brand-surface text-brand-dark ring-brand-border', dot: 'bg-brand-dark' },
}

const FILTERS = ['', 'generating', 'ready_for_review', 'approved', 'rejected', 'published'] as const

// ── Icons ────────────────────────────────────────────────────────────────────

function VideoIcon({ className = 'text-gray-300' }: { className?: string }) {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2.18" /><path d="M10 8l6 4-6 4V8z" />
    </svg>
  )
}
function ImageIcon({ className = 'text-gray-300' }: { className?: string }) {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
    </svg>
  )
}
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" />
    </svg>
  )
}
function UploadCloudIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 16l-4-4-4 4" /><path d="M12 12v9" />
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
    </svg>
  )
}
function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3l3-3-3-3v3A11 11 0 001 12h3z" />
    </svg>
  )
}

interface ReviewClientProps {
  initialCreatives: CreativeWithIdea[]
}

export function ReviewClient({ initialCreatives }: ReviewClientProps) {
  const [creatives, setCreatives] = useState<CreativeWithIdea[]>(initialCreatives)
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<CreativeWithIdea | null>(null)
  const [modalClosing, setModalClosing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const closeModal = useCallback(() => {
    setModalClosing(true)
    setTimeout(() => { setSelected(null); setModalClosing(false); setConfirmDeleteId(null) }, 200)
  }, [])

  useEffect(() => {
    if (!selected) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, closeModal])

  const filtered = creatives.filter((c) => !statusFilter || c.status === statusFilter)
  const generatingCreatives = creatives.filter((c) => c.status === 'generating')
  const generatingCount = generatingCreatives.length

  // Auto-poll generating creatives every 15 seconds (covers both async images & videos).
  useEffect(() => {
    if (generatingCount === 0) return
    const interval = setInterval(async () => {
      const generating = creatives.filter((c) => c.status === 'generating')
      for (const c of generating) {
        const res = await fetch(`/api/creatives/${c.id}/status`).catch(() => null)
        if (!res?.ok) continue
        const data = await res.json()
        if (data.creative && data.status !== 'generating') {
          setCreatives((prev) => prev.map((x) => x.id === c.id ? { ...x, ...data.creative } : x))
          if (selected?.id === c.id) setSelected((s) => s ? { ...s, ...data.creative } : s)
        }
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [generatingCount, creatives, selected?.id])

  const checkNow = useCallback(async (id: string) => {
    setPollingIds((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/creatives/${id}/status`)
      const data = await res.json()
      if (data.creative) {
        setCreatives((prev) => prev.map((x) => x.id === id ? { ...x, ...data.creative } : x))
        if (selected?.id === id) setSelected((s) => s ? { ...s, ...data.creative } : s)
      }
    } finally {
      setPollingIds((prev) => { const s = new Set(prev); s.delete(id); return s })
    }
  }, [selected?.id])

  const handleDeleteCreative = useCallback(async (id: string) => {
    await fetch(`/api/creatives/${id}`, { method: 'DELETE' })
    setCreatives((prev) => prev.filter((c) => c.id !== id))
    setSelected((s) => s?.id === id ? null : s)
    setConfirmDeleteId(null)
  }, [])

  const handleCancel = useCallback(async (id: string) => {
    const res = await fetch(`/api/creatives/${id}/cancel`, { method: 'POST' })
    if (res.ok) {
      setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, status: 'rejected' as never } : c))
      if (selected?.id === id) closeModal()
    }
  }, [selected?.id, closeModal])

  const setStatus = useCallback(async (id: string, status: 'approved' | 'rejected') => {
    await fetch(`/api/creatives/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, status } : c))
    setSelected((s) => s?.id === id ? { ...s, status } : s)
  }, [])

  const handleUpload = useCallback(async (id: string, file: File) => {
    setUploading(true)
    setUploadProgress(0)
    const formData = new FormData()
    formData.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)) }
    await new Promise<void>((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText)
          setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, ...data } : c))
          setSelected((s) => s?.id === id ? { ...s, ...data } : s)
          resolve()
        } else reject(new Error('Upload failed'))
      }
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.open('POST', `/api/creatives/${id}/upload`)
      xhr.send(formData)
    }).catch(() => {})
    setUploading(false)
    setUploadProgress(0)
  }, [])

  const counts = FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f] = f === '' ? creatives.length : creatives.filter((c) => c.status === f).length
    return acc
  }, {})

  return (
    <div className="p-6 max-w-7xl mx-auto animate-page">
      {/* ── Header + filter tabs ── */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-brand-dark">Creative Review</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            {filtered.length} {statusFilter ? STATUS_META[statusFilter]?.label.toLowerCase() : ''} creative{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = statusFilter === f
            return (
              <button
                key={f || 'all'}
                onClick={() => setStatusFilter(f)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
                  active ? 'bg-brand-dark text-white shadow-sm' : 'bg-white border border-brand-border text-brand-muted hover:text-brand-dark hover:border-brand-divider'
                }`}
              >
                {f === '' ? 'All' : STATUS_META[f].label}
                <span className={`ml-1.5 ${active ? 'text-white/60' : 'text-brand-muted/60'}`}>{counts[f]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Generating banner ── */}
      {generatingCount > 0 && (() => {
        const videoCount = generatingCreatives.filter((c) => c.mediaType === 'video').length
        const imageCount = generatingCreatives.filter((c) => c.mediaType === 'image').length
        const parts: string[] = []
        if (videoCount > 0) parts.push(`${videoCount} video${videoCount !== 1 ? 's' : ''}`)
        if (imageCount > 0) parts.push(`${imageCount} image${imageCount !== 1 ? 's' : ''}`)
        return (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <Spinner className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-medium">{parts.join(' and ')} generating.</span>{' '}
              Auto-refreshes every 15 s — or hit &ldquo;Check now&rdquo; on a card.
            </p>
          </div>
        )
      })()}

      {/* ── Grid ── */}
      {filtered.length === 0 ? (
        <div className="border border-dashed border-brand-border rounded-2xl py-20 px-6 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-brand-surface flex items-center justify-center mb-3">
            <ImageIcon className="text-brand-muted" />
          </div>
          <p className="text-sm font-medium text-brand-dark">Nothing here yet</p>
          <p className="text-sm text-brand-muted mt-1">
            {statusFilter ? 'No creatives with this status.' : 'Generate an image or video from the Ideas page to start reviewing.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((creative) => (
            <CreativeCard
              key={creative.id}
              creative={creative}
              checking={pollingIds.has(creative.id)}
              onOpen={() => setSelected(creative)}
              onCheck={() => checkNow(creative.id)}
              onCancel={() => handleCancel(creative.id)}
            />
          ))}
        </div>
      )}

      {/* ── Detail modal ── */}
      {selected && (
        <div
          className={`fixed inset-0 z-50 flex items-start justify-center p-4 overflow-auto ${modalClosing ? 'animate-fade-out-overlay' : 'animate-fade-overlay'}`}
          style={{ backgroundColor: 'rgba(15,18,40,0.55)', backdropFilter: 'blur(2px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className={`bg-white rounded-2xl w-full mt-6 overflow-hidden shadow-2xl shadow-brand-darker/20 ring-1 ring-brand-border ${selected.editedFilePath ? 'max-w-5xl' : 'max-w-4xl'} ${modalClosing ? 'animate-modal-out' : 'animate-modal-in'}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
              <div className="flex items-center gap-2.5 min-w-0">
                <StatusChip status={selected.status} />
                <h2 className="font-semibold text-brand-dark truncate">{selected.idea.title}</h2>
                {selected.editedFilePath && (
                  <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium ring-1 ring-emerald-600/20 shrink-0">Edited</span>
                )}
              </div>
              <button onClick={closeModal} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-dark hover:bg-brand-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30">
                <CloseIcon />
              </button>
            </div>

            <div className="flex flex-col md:flex-row max-h-[calc(100vh-8rem)]">
              {/* Media */}
              <div className="md:flex-1 min-w-0 bg-gradient-to-b from-brand-bg to-brand-surface/60 p-5 flex flex-col">
                {selected.originalFilePath || selected.editedFilePath ? (
                  selected.editedFilePath ? (
                    <div className="grid grid-cols-2 gap-4 flex-1">
                      <MediaStage label="Original" mediaType={selected.mediaType} src={`/api/creatives/${selected.id}/download?version=original`} />
                      <MediaStage label="Edited" highlight mediaType={selected.mediaType} src={`/api/creatives/${selected.id}/download?v=${new Date(selected.updatedAt).getTime()}`} />
                    </div>
                  ) : (
                    <MediaStage label={selected.mediaType === 'image' ? 'Image' : 'Video'} mediaType={selected.mediaType} src={`/api/creatives/${selected.id}/download?v=${new Date(selected.updatedAt).getTime()}`} />
                  )
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-brand-muted min-h-[280px]">
                    {selected.status === 'generating' ? (
                      <>
                        <Spinner className="w-7 h-7 text-brand" />
                        <p className="text-sm font-medium text-brand-dark">Generating {selected.mediaType}…</p>
                        <p className="text-xs text-brand-muted">via {selected.generatorName}</p>
                        <div className="flex gap-3 mt-1">
                          <button onClick={() => checkNow(selected.id)} disabled={pollingIds.has(selected.id)} className="text-xs font-medium text-brand hover:text-brand-dark disabled:opacity-50">
                            {pollingIds.has(selected.id) ? 'Checking…' : 'Check now'}
                          </button>
                          <button onClick={() => handleCancel(selected.id)} className="text-xs font-medium text-red-500 hover:text-red-600">Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        {selected.mediaType === 'image' ? <ImageIcon /> : <VideoIcon />}
                        <p className="text-sm">No {selected.mediaType} available</p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Side panel */}
              <div className="md:w-96 shrink-0 flex flex-col border-t md:border-t-0 md:border-l border-brand-border">
                <div className="flex-1 p-6 space-y-5 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Fact label="Generator">{selected.generatorName}</Fact>
                    <Fact label="Media"><span className="capitalize">{selected.mediaType}</span></Fact>
                    <Fact label="Angle"><span className="capitalize">{selected.idea.angle.replace(/_/g, ' ')}</span></Fact>
                    <Fact label="Human edited">{selected.isHumanEdited ? 'Yes' : 'No'}</Fact>
                    <Fact label="Trend"><TrendDot score={selected.idea.trendScore} warning={selected.idea.trendWarning} /></Fact>
                  </div>

                  <div className="h-px bg-brand-border" />

                  <div className="space-y-4">
                    <Field label="Hook">{selected.idea.hook}</Field>
                    <Field label={selected.mediaType === 'image' ? 'Image visual' : 'Video visual'}>
                      {selected.mediaType === 'image' ? selected.idea.imageVisual : selected.idea.videoVisual}
                    </Field>
                    <Field label="CTA">{selected.idea.cta}</Field>
                  </div>

                  {/* Dropzone */}
                  <Dropzone
                    mediaType={selected.mediaType}
                    uploading={uploading}
                    progress={uploadProgress}
                    onFile={(file) => handleUpload(selected.id, file)}
                  />
                </div>

                {/* Sticky action bar */}
                <div className="border-t border-brand-border px-6 py-4 bg-white/80 backdrop-blur-sm">
                  <div className="flex items-center gap-2">
                    {selected.status === 'ready_for_review' ? (
                      <>
                        <button
                          onClick={() => setStatus(selected.id, 'approved')}
                          className="flex-1 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white px-4 py-2.5 rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                        >
                          {selected.editedFilePath ? 'Approve edited' : 'Approve'}
                        </button>
                        <button
                          onClick={() => setStatus(selected.id, 'rejected')}
                          className="text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 active:scale-[0.98] px-4 py-2.5 rounded-lg transition-all duration-150"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <span className="text-sm text-brand-muted">
                        {selected.status === 'approved' ? 'Approved — ready to publish.' :
                         selected.status === 'rejected' ? 'Rejected.' :
                         selected.status === 'published' ? 'Published.' :
                         'Waiting for generation to finish.'}
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-1">
                      {(selected.originalFilePath || selected.editedFilePath) && (
                        <a
                          href={`/api/creatives/${selected.id}/download`}
                          download
                          className="text-xs font-medium text-brand-muted hover:text-brand-dark px-2.5 py-2 rounded-lg hover:bg-brand-surface transition-colors"
                        >
                          Download
                        </a>
                      )}
                      {confirmDeleteId === selected.id ? (
                        <span className="flex items-center gap-2 text-xs">
                          <button onClick={() => handleDeleteCreative(selected.id)} className="text-red-600 font-medium hover:text-red-700">Confirm delete</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="text-brand-muted hover:text-brand-dark">Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(selected.id)} className="text-xs font-medium text-brand-muted hover:text-red-500 px-2.5 py-2 rounded-lg hover:bg-red-50 transition-colors">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, chip: 'bg-brand-surface text-brand-muted ring-brand-border', dot: 'bg-brand-muted' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ring-1 ring-inset ${m.chip}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

function CreativeCard({
  creative, checking, onOpen, onCheck, onCancel,
}: {
  creative: CreativeWithIdea
  checking: boolean
  onOpen: () => void
  onCheck: () => void
  onCancel: () => void
}) {
  const hasMedia = creative.originalFilePath || creative.thumbnailPath
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className="group bg-white border border-brand-border rounded-xl overflow-hidden cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-darker/5 hover:border-brand-divider transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <div className="aspect-[9/16] bg-brand-bg flex items-center justify-center relative overflow-hidden">
        {hasMedia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/creatives/${creative.id}/download`} alt={creative.idea.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
        ) : creative.mediaType === 'image' ? <ImageIcon /> : <VideoIcon />}

        {/* status overlay (top-left) */}
        <div className="absolute top-2 left-2"><StatusChip status={creative.status} /></div>
        <span className={`absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${creative.mediaType === 'image' ? 'bg-brand-accent/15 text-brand-accent' : 'bg-black/45 text-white'}`}>
          {creative.mediaType === 'image' ? 'IMG' : 'VID'}
        </span>

        {creative.status === 'generating' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-2.5">
            <Spinner className="w-6 h-6 text-white" />
            <span className="text-white text-xs font-medium">Generating…</span>
            <div className="flex gap-2.5">
              <button
                onClick={(e) => { e.stopPropagation(); onCheck() }}
                disabled={checking}
                className="text-xs text-white/80 hover:text-white underline underline-offset-2 disabled:opacity-50"
              >
                {checking ? 'Checking…' : 'Check now'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onCancel() }}
                className="text-xs text-red-300 hover:text-red-100 underline underline-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 space-y-2">
        <p className="text-sm font-medium text-brand-dark truncate">{creative.idea.title}</p>
        <TrendDot score={creative.idea.trendScore} warning={creative.idea.trendWarning} />
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">{label}</span>
      <span className="text-sm text-brand-dark truncate">{children}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted mb-1">{label}</p>
      <p className="text-sm text-brand-dark leading-relaxed">{children}</p>
    </div>
  )
}

function MediaStage({ label, src, mediaType, highlight }: { label: string; src: string; mediaType: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-2 min-w-0 h-full">
      <span className={`text-[11px] font-semibold uppercase tracking-widest ${highlight ? 'text-emerald-600' : 'text-brand-muted'}`}>{label}</span>
      <div className={`flex-1 flex items-center justify-center rounded-xl overflow-hidden min-h-[220px] bg-white ring-1 ${highlight ? 'ring-emerald-500/30' : 'ring-brand-border'}`}>
        {mediaType === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="w-full h-full object-contain max-h-[62vh]" />
        ) : (
          <video src={src} controls className="w-full object-contain max-h-[62vh]" />
        )}
      </div>
    </div>
  )
}

function Dropzone({
  mediaType, uploading, progress, onFile,
}: {
  mediaType: string
  uploading: boolean
  progress: number
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const kind = mediaType === 'image' ? 'image' : 'video'
  const hint = mediaType === 'image' ? 'PNG, JPG or WEBP' : 'MP4 or WEBM'

  const open = () => inputRef.current?.click()

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Upload an edited ${kind}`}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true) }}
      onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
      className={`relative rounded-xl border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
        dragging
          ? 'border-brand bg-brand/5 scale-[1.01]'
          : 'border-brand-border hover:border-brand/50 hover:bg-brand-surface/40'
      }`}
    >
      {uploading ? (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-sm text-brand-dark">
            <Spinner className="w-4 h-4 text-brand" /> Uploading… {progress}%
          </div>
          <div className="h-1.5 bg-brand-surface rounded-full overflow-hidden">
            <div className="h-full bg-brand rounded-full transition-[width] duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${dragging ? 'bg-brand text-white' : 'bg-brand-surface text-brand-muted'}`}>
            <UploadCloudIcon />
          </div>
          <p className="text-sm font-medium text-brand-dark">
            {dragging ? `Drop to replace the ${kind}` : `Drag & drop an edited ${kind}`}
          </p>
          <p className="text-xs text-brand-muted">or <span className="text-brand font-medium">browse</span> · {hint}</p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={mediaType === 'image' ? 'image/*' : 'video/*'}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </div>
  )
}
