'use client'

import { useState, useCallback, useEffect } from 'react'
import type { Creative, Idea, Post } from '@prisma/client'
import { CloseIcon } from '@/components/ui/icons'
import { DateTimePicker } from '@/components/ui/DateTimePicker'

type CreativeWithIdea = Creative & { idea: Idea }
type PostWithCreative = Post & { creative: CreativeWithIdea }

type ImportedAd = {
  id: string
  metaAdId: string
  adName: string
  campaignName: string | null
  cpl: number
  leads: number
  isSuccessful: boolean
}

interface PublishClientProps {
  approvedCreatives: CreativeWithIdea[]
  initialPosts: PostWithCreative[]
  initialImportedAds: ImportedAd[]
}

const POST_STATUS_COLORS: Record<string, string> = {
  queued:  'bg-amber-50 text-amber-700',
  posted:  'bg-emerald-50 text-emerald-700',
  failed:  'bg-red-50 text-red-700',
  deleted: 'bg-gray-100 text-gray-500 line-through',
}

function VideoIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted">
      <rect x="2" y="2" width="20" height="20" rx="2.18"/>
      <path d="M10 8l6 4-6 4V8z"/>
    </svg>
  )
}

function ImageIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
    </svg>
  )
}

function HourSpinner({ value, onChange, max = 23 }: { value: number; onChange: (h: number) => void; max?: number }) {
  const min = 0
  const to12 = (h: number) => ({ h12: h === 0 ? 12 : h > 12 ? h - 12 : h, ampm: h < 12 ? 'AM' : 'PM' })
  const to24 = (h12: number, ampm: string) => ampm === 'AM' ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12)
  const { h12, ampm } = to12(value)

  const [hourDraft, setHourDraft] = useState(String(h12))
  const [ampmDraft, setAmpmDraft] = useState(ampm)
  useEffect(() => { setHourDraft(String(to12(value).h12)); setAmpmDraft(to12(value).ampm) }, [value])

  const commitHour = (raw: string) => {
    const n = parseInt(raw, 10)
    if (!isNaN(n)) { const h24 = Math.max(min, Math.min(max, to24(Math.max(1, Math.min(12, n)), ampmDraft))); onChange(h24) }
    setHourDraft(String(to12(value).h12))
  }
  const commitAmpm = (raw: string) => {
    const next = raw.toUpperCase().startsWith('P') ? 'PM' : raw.toUpperCase().startsWith('A') ? 'AM' : null
    if (next) { onChange(to24(h12, next)); setAmpmDraft(next) }
    else setAmpmDraft(ampm)
  }

  const chevUp = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
  const chevDn = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>

  return (
    <div className="flex gap-1">
      {/* Hour */}
      <div className="flex flex-col items-center border border-brand-border rounded-lg overflow-hidden w-10">
        <button type="button" onClick={() => onChange(value >= max ? min : value + 1)} className="w-full py-1 hover:bg-brand-bg text-brand-muted hover:text-brand-dark transition-colors flex justify-center">{chevUp}</button>
        <input value={hourDraft} onChange={e => setHourDraft(e.target.value)} onBlur={() => commitHour(hourDraft)} onKeyDown={e => e.key === 'Enter' && commitHour(hourDraft)}
          inputMode="numeric" onFocus={e => e.currentTarget.select()}
          className="w-full text-center text-sm font-semibold text-brand-dark py-1.5 focus:outline-none focus:bg-brand-bg transition-colors" style={{ minWidth: 0 }} />
        <button type="button" onClick={() => onChange(value <= min ? max : value - 1)} className="w-full py-1 hover:bg-brand-bg text-brand-muted hover:text-brand-dark transition-colors flex justify-center">{chevDn}</button>
      </div>
      {/* AM/PM */}
      <div className="flex flex-col items-center border border-brand-border rounded-lg overflow-hidden w-12">
        <button type="button" onClick={() => onChange(to24(h12, ampm === 'AM' ? 'PM' : 'AM'))} className="w-full py-1 hover:bg-brand-bg text-brand-muted hover:text-brand-dark transition-colors flex justify-center">{chevUp}</button>
        <input value={ampmDraft} onChange={e => { setAmpmDraft(e.target.value); if (e.target.value.toLowerCase().startsWith('p')) commitAmpm('PM'); else if (e.target.value.toLowerCase().startsWith('a')) commitAmpm('AM') }}
          onBlur={() => commitAmpm(ampmDraft)} onKeyDown={e => e.key === 'Enter' && commitAmpm(ampmDraft)}
          onFocus={e => e.currentTarget.select()}
          className="w-full text-center text-sm font-semibold text-brand-dark py-1.5 focus:outline-none focus:bg-brand-bg transition-colors" style={{ minWidth: 0 }} />
        <button type="button" onClick={() => onChange(to24(h12, ampm === 'AM' ? 'PM' : 'AM'))} className="w-full py-1 hover:bg-brand-bg text-brand-muted hover:text-brand-dark transition-colors flex justify-center">{chevDn}</button>
      </div>
    </div>
  )
}

function MediaThumb({ creative, size = 'sm' }: { creative: CreativeWithIdea; size?: 'sm' | 'lg' }) {
  const hasFile = !!(creative.originalFilePath || creative.editedFilePath)
  const dim = size === 'lg' ? 'w-full h-full' : 'w-full h-full'
  if (hasFile && creative.mediaType === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/creatives/${creative.id}/download?v=${new Date(creative.updatedAt).getTime()}`} alt="" className={`${dim} object-cover`} />
    )
  }
  return creative.mediaType === 'image' ? <ImageIcon size={size === 'lg' ? 28 : 20} /> : <VideoIcon size={size === 'lg' ? 28 : 20} />
}

export function PublishClient({ approvedCreatives: initialApprovedCreatives, initialPosts, initialImportedAds }: PublishClientProps) {
  const [approvedCreatives, setApprovedCreatives] = useState<CreativeWithIdea[]>(initialApprovedCreatives)
  const [posts, setPosts] = useState<PostWithCreative[]>(initialPosts)
  const [confirmCreative, setConfirmCreative] = useState<CreativeWithIdea | null>(null)
  const [modalClosing, setModalClosing] = useState(false)
  const [previewCreative, setPreviewCreative] = useState<CreativeWithIdea | null>(null)
  const [previewClosing, setPreviewClosing] = useState(false)
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['meta'])
  const [scheduledAt, setScheduledAt] = useState('')
  const [useAdSchedule, setUseAdSchedule] = useState(false)
  const [adScheduleDays, setAdScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]) // Mon-Fri
  const [adScheduleStartHour, setAdScheduleStartHour] = useState(7)
  const [adScheduleEndHour, setAdScheduleEndHour] = useState(22)
  const [modalPosting, setModalPosting] = useState(false)
  const [postingCreativeIds, setPostingCreativeIds] = useState<Set<string>>(new Set())
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [postFilter, setPostFilter] = useState<'all' | 'meta' | 'youtube'>('all')
  const [reconciling, setReconciling] = useState(false)

  const visiblePosts = postFilter === 'all' ? posts : posts.filter((p) => p.platform === postFilter)

  const closePreview = useCallback(() => {
    setPreviewClosing(true)
    setTimeout(() => { setPreviewCreative(null); setPreviewClosing(false) }, 200)
  }, [])

  const closeModal = useCallback(() => {
    setModalClosing(true)
    setTimeout(() => { setConfirmCreative(null); setModalClosing(false) }, 200)
  }, [])

  const handleCreatePost = useCallback(async () => {
    if (!confirmCreative) return
    const creative = confirmCreative
    setModalPosting(true)
    setError('')

    try {
      // Delete any existing failed posts for this creative before retrying
      const failedPosts = posts.filter(p => p.creativeId === creative.id && p.status === 'failed')
      if (failedPosts.length > 0) {
        await Promise.all(failedPosts.map(p => fetch(`/api/posts/${p.id}`, { method: 'DELETE' })))
        setPosts(prev => prev.filter(p => !failedPosts.some(fp => fp.id === p.id)))
      }

      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creativeId: creative.id,
          platforms: selectedPlatforms,
          scheduledAt: scheduledAt || undefined,
          adSchedule: useAdSchedule ? {
            days: adScheduleDays,
            startHour: adScheduleStartHour,
            endHour: adScheduleEndHour,
          } : undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to queue post')
        return
      }

      const newPosts = await res.json()

      // Close modal and move to in-flight state before publishing
      closeModal()
      setPostingCreativeIds(prev => new Set([...prev, creative.id]))

      let allSucceeded = true
      if (!scheduledAt) {
        for (const post of newPosts) {
          const publishRes = await fetch(`/api/posts/${post.id}/publish`, { method: 'POST' })
          if (!publishRes.ok) allSucceeded = false
        }
      }

      const allPosts = await fetch('/api/posts').then((r) => r.json())
      setPosts(allPosts)

      if (allSucceeded) {
        setApprovedCreatives(prev => prev.filter(c => c.id !== creative.id))
      }
    } finally {
      setModalPosting(false)
      setPostingCreativeIds(prev => {
        const next = new Set(prev)
        next.delete(creative.id)
        return next
      })
    }
  }, [confirmCreative, selectedPlatforms, scheduledAt, posts, closeModal])

  useEffect(() => {
    if (!confirmCreative) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [confirmCreative, closeModal])

  useEffect(() => {
    if (!previewCreative) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePreview() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [previewCreative, closePreview])

  const handlePublishNow = useCallback(async (postId: string) => {
    setPublishingPostId(postId)
    try {
      await fetch(`/api/posts/${postId}/publish`, { method: 'POST' })
      const allPosts = await fetch('/api/posts').then((r) => r.json())
      setPosts(allPosts)
    } finally {
      setPublishingPostId(null)
    }
  }, [])

  const handleDeletePost = useCallback(async (postId: string) => {
    await fetch(`/api/posts/${postId}`, { method: 'DELETE' })
    setPosts(prev => prev.filter(p => p.id !== postId))
  }, [])

  // Reconcile against Meta Ads Manager: ads deleted there get marked "deleted" here.
  const handleReconcile = useCallback(async () => {
    setReconciling(true)
    try {
      await fetch('/api/posts/reconcile', { method: 'POST' })
      const allPosts = await fetch('/api/posts').then((r) => r.json())
      setPosts(allPosts)
    } finally {
      setReconciling(false)
    }
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8 animate-page">
      <h1 className="text-2xl font-semibold text-brand-dark">Publish Queue</h1>

      <section>
        <h2 className="text-lg font-medium text-brand-dark mb-4">
          Approved and ready ({approvedCreatives.length})
        </h2>
        {approvedCreatives.length === 0 ? (
          <p className="text-brand-muted text-sm">No approved creatives. Go to Review to approve videos.</p>
        ) : (
          <div className="space-y-3">
            {approvedCreatives.map((creative) => {
              const isPosting = postingCreativeIds.has(creative.id)
              const hasFailed = posts.some(p => p.creativeId === creative.id && p.status === 'failed')
              return (
                <div key={creative.id} className="bg-white border border-brand-border rounded-xl p-4 flex items-center gap-4 hover:border-brand-divider transition-colors">
                  <button
                    onClick={() => setPreviewCreative(creative)}
                    className="w-12 h-12 bg-brand-bg rounded-lg flex items-center justify-center shrink-0 overflow-hidden hover:ring-2 hover:ring-brand/30 transition-all"
                    title="Preview"
                  >
                    <MediaThumb creative={creative} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-brand-dark">{creative.idea.title}</p>
                    <p className="text-sm text-brand-muted">
                      {creative.generatorName} · {creative.isHumanEdited ? 'Human edited' : 'Original'}
                    </p>
                  </div>
                  {isPosting ? (
                    <button disabled className="bg-brand/60 text-white text-sm px-4 py-2 rounded-lg opacity-70 cursor-not-allowed">
                      Posting...
                    </button>
                  ) : hasFailed ? (
                    <button
                      onClick={() => setConfirmCreative(creative)}
                      className="bg-red-600 hover:bg-red-500 active:scale-[0.97] text-white text-sm px-4 py-2 rounded-lg transition-all duration-200 shadow-sm"
                    >
                      Retry
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmCreative(creative)}
                      className="bg-brand hover:bg-brand-dark active:scale-[0.97] text-white text-sm px-4 py-2 rounded-lg transition-all duration-200 shadow-sm"
                    >
                      Post
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-brand-dark">All posts ({visiblePosts.length})</h2>
          <div className="flex items-center gap-2">
          <button
            onClick={handleReconcile}
            disabled={reconciling}
            className="text-sm border border-brand-border hover:border-brand text-brand-muted hover:text-brand px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            title="Check Meta Ads Manager and flag any ads deleted there"
          >
            {reconciling ? 'Refreshing…' : 'Refresh from Meta'}
          </button>
          <div className="flex rounded-lg border border-brand-border overflow-hidden text-sm">
            {([['all', 'All'], ['meta', 'Meta'], ['youtube', 'YouTube']] as const).map(([p, label]) => (
              <button
                key={p}
                onClick={() => setPostFilter(p)}
                className={`px-3 py-1.5 transition-colors ${
                  postFilter === p
                    ? 'bg-brand text-white'
                    : 'text-brand-muted hover:text-brand-dark hover:bg-brand-bg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          </div>
        </div>
        {visiblePosts.length === 0 ? (
          <p className="text-brand-muted text-sm">{posts.length === 0 ? 'No posts yet.' : `No ${postFilter} posts.`}</p>
        ) : (
          <div className="space-y-3">
            {visiblePosts.map((post) => (
              <div key={post.id} className="bg-white border border-brand-border rounded-xl p-4 flex items-center gap-4">
                <button
                  onClick={() => setPreviewCreative(post.creative)}
                  className="w-12 h-12 bg-brand-bg rounded-lg flex items-center justify-center shrink-0 overflow-hidden hover:ring-2 hover:ring-brand/30 transition-all"
                  title="Preview"
                >
                  <MediaThumb creative={post.creative} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-brand-dark">{post.creative.idea.title}</p>
                  <div className="flex items-center gap-x-3 gap-y-1 mt-1 flex-wrap">
                    <span className="text-xs text-brand-muted capitalize">{post.platform}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${POST_STATUS_COLORS[post.status] ?? 'bg-brand-surface text-brand-muted'}`}>
                      {post.status}
                    </span>
                    {(post.platformMetadata as { draft?: boolean } | null)?.draft && post.status === 'posted' && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200"
                        title="Saved as a paused draft on Meta (META_DRAFT_MODE) — not delivering"
                      >
                        Draft
                      </span>
                    )}
                    {post.scheduledAt && (
                      <span className="text-xs text-brand-muted">
                        Scheduled: {new Date(post.scheduledAt).toLocaleString()}
                      </span>
                    )}
                    {post.postedAt && (
                      <span className="text-xs text-brand-muted">
                        Posted: {new Date(post.postedAt).toLocaleString()}
                      </span>
                    )}
                    {post.externalPostId && (
                      <span className="text-xs text-brand-muted font-mono max-w-[10rem] truncate" title={post.externalPostId}>
                        {post.externalPostId}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {post.status === 'queued' && (
                    <button
                      onClick={() => handlePublishNow(post.id)}
                      disabled={publishingPostId === post.id}
                      className="text-sm border border-brand-border hover:border-indigo-400 text-brand-muted hover:text-brand px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {publishingPostId === post.id ? 'Publishing...' : 'Publish now'}
                    </button>
                  )}
                  {post.status === 'failed' && (
                    <>
                      <button
                        onClick={() => handlePublishNow(post.id)}
                        disabled={publishingPostId === post.id}
                        className="text-sm bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {publishingPostId === post.id ? 'Retrying...' : 'Retry'}
                      </button>
                      <button
                        onClick={() => handleDeletePost(post.id)}
                        className="text-brand-muted hover:text-red-500 p-1.5 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                  {post.status === 'deleted' && (
                    <>
                      <span className="text-xs text-brand-muted">Deleted on Meta</span>
                      <button
                        onClick={() => handleDeletePost(post.id)}
                        className="text-brand-muted hover:text-red-500 p-1.5 rounded-lg transition-colors"
                        title="Remove from queue"
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(postFilter === 'all' || postFilter === 'meta') && initialImportedAds.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-brand-dark">Imported from Meta ({initialImportedAds.length})</h2>
          <p className="text-sm text-brand-muted mt-0.5 mb-4">Real ads pulled from your Meta account, sorted by CPL.</p>
          <div className="space-y-2">
            {initialImportedAds.slice(0, 50).map((ad) => (
              <div key={ad.id} className="bg-white border border-brand-border rounded-xl px-4 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-brand-dark truncate" title={ad.adName}>{ad.adName}</p>
                  <div className="flex items-center gap-x-3 gap-y-1 mt-1 flex-wrap text-xs text-brand-muted">
                    <span>meta</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">posted</span>
                    <span>CPL {ad.cpl.toFixed(0)}</span>
                    <span>{ad.leads} leads</span>
                    {ad.campaignName && <span className="truncate max-w-[12rem]" title={ad.campaignName}>{ad.campaignName}</span>}
                    <span className="font-mono truncate max-w-[10rem]" title={ad.metaAdId}>{ad.metaAdId}</span>
                  </div>
                </div>
                {ad.isSuccessful && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 shrink-0">under target</span>
                )}
              </div>
            ))}
          </div>
          {initialImportedAds.length > 50 && (
            <p className="text-xs text-brand-muted mt-3">Showing the 50 lowest-CPL ads of {initialImportedAds.length}.</p>
          )}
        </section>
      )}

      {/* Preview modal */}
      {previewCreative && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${previewClosing ? 'animate-fade-out-overlay' : 'animate-fade-overlay'}`}
          style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closePreview() }}
        >
          <div className={`bg-gray-950 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl w-full max-w-sm ${previewClosing ? 'animate-modal-out' : 'animate-modal-in'}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div>
                <p className="text-white font-medium text-sm">{previewCreative.idea.title}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {previewCreative.mediaType === 'image' ? 'Image ad' : 'Video ad'}
                  {previewCreative.generatorName ? ` · ${previewCreative.generatorName}` : ''}
                  {previewCreative.isHumanEdited ? ' · Edited' : ''}
                </p>
              </div>
              <button onClick={closePreview} className="text-gray-500 hover:text-white transition-colors ml-4">
                <CloseIcon />
              </button>
            </div>
            <div className="p-3">
              {previewCreative.originalFilePath || previewCreative.editedFilePath ? (
                previewCreative.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/creatives/${previewCreative.id}/download?v=${new Date(previewCreative.updatedAt).getTime()}`}
                    alt=""
                    className="w-full rounded-xl object-contain max-h-[70vh]"
                  />
                ) : (
                  <video
                    src={`/api/creatives/${previewCreative.id}/download?v=${new Date(previewCreative.updatedAt).getTime()}`}
                    controls
                    autoPlay
                    className="w-full rounded-xl max-h-[70vh]"
                  />
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-600">
                  {previewCreative.mediaType === 'image' ? <ImageIcon size={32} /> : <VideoIcon size={32} />}
                  <p className="text-sm">No {previewCreative.mediaType} available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmCreative && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center ${modalClosing ? 'animate-fade-out-overlay' : 'animate-fade-overlay'}`}
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className={`bg-white border border-brand-border rounded-2xl p-6 w-full max-w-md space-y-5 shadow-2xl ${modalClosing ? 'animate-modal-out' : 'animate-modal-in'}`}>
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-brand-dark">
                Post &ldquo;{confirmCreative.idea.title}&rdquo;
              </h3>
              <button
                onClick={closeModal}
                className="text-brand-muted hover:text-brand-dark transition-colors mt-0.5"
              >
                <CloseIcon />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-brand-dark mb-1.5">Platforms</label>
              <div className="flex gap-3">
                {['meta', 'youtube'].map((p) => (
                  <label key={p} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPlatforms.includes(p)}
                      onChange={(e) => setSelectedPlatforms(
                        e.target.checked
                          ? [...selectedPlatforms, p]
                          : selectedPlatforms.filter((x) => x !== p)
                      )}
                      className="accent-indigo-500"
                    />
                    <span className="text-sm text-brand-dark capitalize">{p}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-brand-dark mb-1.5">
                Schedule <span className="font-normal text-brand-muted">(leave empty to post now)</span>
              </label>
              <DateTimePicker value={scheduledAt} onChange={setScheduledAt} />
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <div
                  onClick={() => setUseAdSchedule(v => !v)}
                  className={`relative w-8 h-4.5 rounded-full transition-colors cursor-pointer ${useAdSchedule ? 'bg-brand' : 'bg-brand-border'}`}
                  style={{ height: '1.125rem' }}
                >
                  <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${useAdSchedule ? 'translate-x-3.5' : ''}`} />
                </div>
                <span className="text-sm font-medium text-brand-dark">Ad schedule</span>
                <span className="text-sm font-normal text-brand-muted">(when the ad runs)</span>
              </label>

              {useAdSchedule && (
                <div className="bg-brand-bg border border-brand-border rounded-lg p-3 space-y-3">
                  <div>
                    <p className="text-xs text-brand-muted mb-1.5">Active days</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setAdScheduleDays(prev =>
                            prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].sort()
                          )}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                            adScheduleDays.includes(i)
                              ? 'bg-brand text-white border-brand'
                              : 'bg-white border-brand-border text-brand-muted hover:border-brand-divider'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-brand-muted mb-1.5">Active hours</p>
                    <div className="flex items-center gap-3">
                      <HourSpinner value={adScheduleStartHour} onChange={setAdScheduleStartHour} />
                      <span className="text-xs text-brand-muted">to</span>
                      <HourSpinner value={adScheduleEndHour} onChange={v => setAdScheduleEndHour(v === 0 ? 1 : v)} max={24} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">{error}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 border border-brand-border text-brand-muted py-2 rounded-lg text-sm hover:border-brand-divider hover:bg-brand-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={modalPosting || selectedPlatforms.length === 0}
                className="flex-1 bg-brand hover:bg-brand-dark active:scale-[0.98] disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-all duration-200"
              >
                {modalPosting ? 'Posting...' : scheduledAt ? 'Schedule' : 'Post now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
