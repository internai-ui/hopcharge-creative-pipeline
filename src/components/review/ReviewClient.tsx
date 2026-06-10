'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Creative, Idea } from '@prisma/client'
import { TrendDot } from '@/components/ideas/TrendDot'

type CreativeWithIdea = Creative & { idea: Idea }

const STATUS_COLORS: Record<string, string> = {
  generating:       'bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  ready_for_review: 'bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  approved:         'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  rejected:         'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300',
  published:        'bg-indigo-50 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
}

function VideoIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-zinc-600">
      <rect x="2" y="2" width="20" height="20" rx="2.18"/>
      <path d="M10 8l6 4-6 4V8z"/>
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-zinc-600">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="1" y1="1" x2="13" y2="13"/>
      <line x1="13" y1="1" x2="1" y2="13"/>
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
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filtered = creatives.filter((c) => !statusFilter || c.status === statusFilter)

  const generatingCreatives = creatives.filter(c => c.status === 'generating')
  const generatingCount = generatingCreatives.length

  // Auto-poll generating creatives every 15 seconds
  useEffect(() => {
    if (generatingCount === 0) return
    const interval = setInterval(async () => {
      const generating = creatives.filter(c => c.status === 'generating')
      for (const c of generating) {
        const res = await fetch(`/api/creatives/${c.id}/status`).catch(() => null)
        if (!res?.ok) continue
        const data = await res.json()
        if (data.creative && data.status !== 'generating') {
          setCreatives(prev => prev.map(x => x.id === c.id ? { ...x, ...data.creative } : x))
          if (selected?.id === c.id) setSelected(s => s ? { ...s, ...data.creative } : s)
        }
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [generatingCount, creatives, selected?.id])

  const handleDeleteCreative = useCallback(async (id: string) => {
    await fetch(`/api/creatives/${id}`, { method: 'DELETE' })
    setCreatives(prev => prev.filter(c => c.id !== id))
    setSelected(s => s?.id === id ? null : s)
    setConfirmDeleteId(null)
  }, [])

  const handleCancel = useCallback(async (id: string) => {
    const res = await fetch(`/api/creatives/${id}/cancel`, { method: 'POST' })
    if (res.ok) {
      setCreatives(prev => prev.map(c => c.id === id ? { ...c, status: 'rejected' as never } : c))
      if (selected?.id === id) setSelected(null)
    }
  }, [selected?.id])

  const pollStatus = useCallback(async (id: string) => {
    const res = await fetch(`/api/creatives/${id}/status`)
    const data = await res.json()
    setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, ...data.creative } : c))
    if (selected?.id === id) setSelected((s) => s ? { ...s, ...data.creative } : s)
    return data.status
  }, [selected?.id])

  const handleApprove = useCallback(async (id: string) => {
    await fetch(`/api/creatives/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, status: 'approved' } : c))
    setSelected((s) => s?.id === id ? { ...s, status: 'approved' } : s)
  }, [])

  const handleReject = useCallback(async (id: string) => {
    await fetch(`/api/creatives/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    })
    setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, status: 'rejected' } : c))
    setSelected((s) => s?.id === id ? { ...s, status: 'rejected' } : s)
  }, [])

  const handleUpload = useCallback(async (id: string, file: File) => {
    setUploading(true)
    setUploadProgress(0)

    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
    }

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
    })

    setUploading(false)
    setUploadProgress(0)
  }, [])

  return (
    <div className="p-6 animate-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Creative Review</h1>
          <p className="text-sm text-gray-400 dark:text-zinc-500 mt-0.5">{filtered.length} creatives</p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-sm text-gray-700 dark:text-zinc-300 px-3 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
        >
          <option value="">All statuses</option>
          <option value="generating">Generating</option>
          <option value="ready_for_review">Ready for review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="published">Published</option>
        </select>
      </div>

      {generatingCount > 0 && (() => {
        const videoCount = generatingCreatives.filter(c => c.mediaType === 'video').length
        const imageCount = generatingCreatives.filter(c => c.mediaType === 'image').length
        const generatorNames = [...new Set(generatingCreatives.map(c => c.generatorName).filter(Boolean))]

        const parts: string[] = []
        if (videoCount > 0) parts.push(`${videoCount} video${videoCount !== 1 ? 's' : ''}`)
        if (imageCount > 0) parts.push(`${imageCount} image${imageCount !== 1 ? 's' : ''}`)
        const label = parts.join(' and ')
        const via = generatorNames.length > 0 ? ` via ${generatorNames.join(', ')}` : ''

        return (
          <div className="mb-5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl px-4 py-3 flex items-center gap-3">
            <svg className="animate-spin w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3l3-3-3-3v3A11 11 0 001 12h3z"/>
            </svg>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              <span className="font-medium">{label} generating{via}.</span>
              {' '}Auto-refreshes every 15 s, or click &quot;Check now&quot; on any card.
            </p>
          </div>
        )
      })()}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map((creative) => (
          <div
            key={creative.id}
            className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden cursor-pointer hover:border-indigo-300 dark:hover:border-zinc-600 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/30 transition-all duration-150"
            onClick={() => setSelected(creative)}
          >
            <div className="aspect-[9/16] bg-gray-50 dark:bg-zinc-800 flex items-center justify-center relative overflow-hidden">
              {creative.originalFilePath && creative.mediaType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/creatives/${creative.id}/download`} alt="" className="w-full h-full object-cover" />
              ) : creative.thumbnailPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/creatives/${creative.id}/download`} alt="" className="w-full h-full object-cover" />
              ) : creative.mediaType === 'image' ? (
                <ImageIcon />
              ) : (
                <VideoIcon />
              )}
              {creative.status === 'generating' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-2">
                  <svg className="animate-spin w-6 h-6 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3l3-3-3-3v3A11 11 0 001 12h3z"/>
                  </svg>
                  <span className="text-white text-xs font-medium">Generating...</span>
                  <div className="flex gap-2">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        setPollingIds(prev => new Set(prev).add(creative.id))
                        try {
                          const res = await fetch(`/api/creatives/${creative.id}/status`)
                          const data = await res.json()
                          if (data.creative) setCreatives(prev => prev.map(x => x.id === creative.id ? { ...x, ...data.creative } : x))
                        } finally {
                          setPollingIds(prev => { const s = new Set(prev); s.delete(creative.id); return s })
                        }
                      }}
                      disabled={pollingIds.has(creative.id)}
                      className="text-xs text-white/70 hover:text-white underline underline-offset-2 disabled:opacity-50"
                    >
                      {pollingIds.has(creative.id) ? 'Checking...' : 'Check now'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCancel(creative.id) }}
                      className="text-xs text-red-300 hover:text-red-100 underline underline-offset-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 space-y-1.5">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{creative.idea.title}</p>
              <div className="flex items-center justify-between gap-1">
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[creative.status] ?? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                  {creative.status}
                </span>
                <div className="flex items-center gap-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${creative.mediaType === 'image' ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                    {creative.mediaType === 'image' ? 'img' : 'vid'}
                  </span>
                </div>
              </div>
              <TrendDot score={creative.idea.trendScore} warning={creative.idea.trendWarning} />
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full text-center py-20 text-gray-400 dark:text-zinc-500">
            No creatives yet. Select an idea from the Ideas page to start generating.
          </div>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 dark:bg-black/60 p-4 overflow-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null) }}
        >
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl mt-8 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
              <h2 className="font-semibold text-gray-900 dark:text-white">{selected.idea.title}</h2>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex gap-0">
              <div className="w-64 shrink-0 bg-gray-900 dark:bg-black flex flex-col items-center justify-center p-4 gap-3">
                {selected.originalFilePath || selected.editedFilePath ? (
                  <>
                    {selected.mediaType === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/creatives/${selected.id}/download`}
                        alt=""
                        className="max-h-80 w-full rounded-lg object-contain"
                      />
                    ) : (
                      <video
                        src={`/api/creatives/${selected.id}/download`}
                        controls
                        className="max-h-80 w-full rounded-lg"
                      />
                    )}
                    {selected.status === 'ready_for_review' && (
                      <button
                        onClick={async () => { await handleApprove(selected.id); setSelected(null) }}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-sm font-medium rounded-lg transition-all duration-150"
                      >
                        Use current {selected.mediaType === 'image' ? 'image' : 'video'}
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center">
                    {selected.mediaType === 'image' ? <ImageIcon /> : <VideoIcon />}
                    <p className="text-gray-400 text-sm mt-2">
                      {selected.status === 'generating'
                        ? `Generating ${selected.mediaType}...`
                        : `No ${selected.mediaType}`}
                    </p>
                    {selected.status === 'generating' && (
                      <div className="flex gap-3 mt-2">
                        <button onClick={() => pollStatus(selected.id)} className="text-xs text-indigo-400 hover:text-indigo-300">Check status</button>
                        <button onClick={() => handleCancel(selected.id)} className="text-xs text-red-400 hover:text-red-300">Cancel</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 p-6 space-y-4 border-l border-gray-200 dark:border-zinc-800">
                <div className="space-y-2">
                  <InfoRow label="Status">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[selected.status] ?? ''}`}>
                      {selected.status}
                    </span>
                  </InfoRow>
                  <InfoRow label="Generator">{selected.generatorName}</InfoRow>
                  <InfoRow label="Human edited">{selected.isHumanEdited ? 'Yes' : 'No'}</InfoRow>
                  <InfoRow label="Trend">
                    <TrendDot score={selected.idea.trendScore} warning={selected.idea.trendWarning} />
                  </InfoRow>
                  <InfoRow label="Hook">{selected.idea.hook}</InfoRow>
                  <InfoRow label="Image visual">{selected.idea.imageVisual}</InfoRow>
                  <InfoRow label="Video visual">{selected.idea.videoVisual}</InfoRow>
                  <InfoRow label="CTA">{selected.idea.cta}</InfoRow>
                  <InfoRow label="Angle">{selected.idea.angle}</InfoRow>
                </div>

                <div
                  className="border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-xl p-4 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-all duration-150"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const file = e.dataTransfer.files[0]
                    if (file) handleUpload(selected.id, file)
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <p className="text-sm text-gray-500 dark:text-zinc-400">
                    Drop edited {selected.mediaType === 'image' ? 'image' : 'video'} here or click to browse
                  </p>
                  {uploading && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full transition-[width] duration-300" style={{ width: `${uploadProgress}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">{uploadProgress}%</p>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" className="hidden" accept={selected.mediaType === 'image' ? 'image/*' : 'video/*'} onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleUpload(selected.id, f)
                  }} />
                </div>

                <div className="flex gap-3 flex-wrap items-center">
                  {(selected.originalFilePath || selected.editedFilePath) && (
                    <a
                      href={`/api/creatives/${selected.id}/download`}
                      download
                      className="text-sm border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-zinc-600 px-4 py-2 rounded-lg transition-colors"
                    >
                      Download
                    </a>
                  )}
                  {selected.status === 'ready_for_review' && (
                    <>
                      <button
                        onClick={() => handleApprove(selected.id)}
                        className="text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-[0.97] text-white px-4 py-2 rounded-lg transition-all duration-150"
                      >
                        Approve with edits
                      </button>
                      <button
                        onClick={() => handleReject(selected.id)}
                        className="text-sm border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 px-4 py-2 rounded-lg transition-colors"
                      >
                        Reject
                      </button>
                    </>
                  )}

                  {/* Delete with confirmation */}
                  <div className="ml-auto">
                    {confirmDeleteId === selected.id ? (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-500 dark:text-zinc-400">Delete this creative?</span>
                        <button
                          onClick={() => handleDeleteCreative(selected.id)}
                          className="text-red-600 dark:text-red-400 font-medium hover:text-red-700 transition-colors"
                        >
                          Yes, delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-gray-400 dark:text-zinc-600 hover:text-gray-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(selected.id)}
                        className="text-sm text-gray-400 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    )}
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

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-xs text-gray-400 dark:text-zinc-500 w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-700 dark:text-zinc-300">{children}</span>
    </div>
  )
}
