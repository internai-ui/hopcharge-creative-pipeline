'use client'

import { useState, useCallback } from 'react'
import type { Creative, Idea, Post } from '@prisma/client'
import { CloseIcon } from '@/components/ui/icons'

type CreativeWithIdea = Creative & { idea: Idea }
type PostWithCreative = Post & { creative: CreativeWithIdea }

interface PublishClientProps {
  approvedCreatives: CreativeWithIdea[]
  initialPosts: PostWithCreative[]
}

const POST_STATUS_COLORS: Record<string, string> = {
  queued:  'bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  posted:  'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  failed:  'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300',
}

function VideoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 dark:text-zinc-500">
      <rect x="2" y="2" width="20" height="20" rx="2.18"/>
      <path d="M10 8l6 4-6 4V8z"/>
    </svg>
  )
}

export function PublishClient({ approvedCreatives, initialPosts }: PublishClientProps) {
  const [posts, setPosts] = useState<PostWithCreative[]>(initialPosts)
  const [confirmCreative, setConfirmCreative] = useState<CreativeWithIdea | null>(null)
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['meta'])
  const [scheduledAt, setScheduledAt] = useState('')
  const [posting, setPosting] = useState<string | null>(null)
  const [error, setError] = useState('')

  const handleCreatePost = useCallback(async () => {
    if (!confirmCreative) return
    setPosting(confirmCreative.id)
    setError('')

    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creativeId: confirmCreative.id,
          platforms: selectedPlatforms,
          scheduledAt: scheduledAt || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to queue post')
        return
      }

      const newPosts = await res.json()
      if (!scheduledAt) {
        for (const post of newPosts) {
          await fetch(`/api/posts/${post.id}/publish`, { method: 'POST' })
        }
      }

      const allPosts = await fetch('/api/posts').then((r) => r.json())
      setPosts(allPosts)
      setConfirmCreative(null)
    } finally {
      setPosting(null)
    }
  }, [confirmCreative, selectedPlatforms, scheduledAt])

  const handlePublishNow = useCallback(async (postId: string) => {
    setPosting(postId)
    try {
      await fetch(`/api/posts/${postId}/publish`, { method: 'POST' })
      const allPosts = await fetch('/api/posts').then((r) => r.json())
      setPosts(allPosts)
    } finally {
      setPosting(null)
    }
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8 animate-page">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Publish Queue</h1>

      <section>
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Approved and ready ({approvedCreatives.length})
        </h2>
        {approvedCreatives.length === 0 ? (
          <p className="text-gray-500 dark:text-zinc-500 text-sm">No approved creatives. Go to Review to approve videos.</p>
        ) : (
          <div className="space-y-3">
            {approvedCreatives.map((creative) => (
              <div key={creative.id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-4 hover:border-gray-300 dark:hover:border-zinc-700 transition-colors">
                <div className="w-12 h-12 bg-gray-50 dark:bg-zinc-800 rounded-lg flex items-center justify-center shrink-0">
                  <VideoIcon />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white">{creative.idea.title}</p>
                  <p className="text-sm text-gray-500 dark:text-zinc-500">
                    {creative.generatorName} · {creative.isHumanEdited ? 'Human edited' : 'Original'}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmCreative(creative)}
                  className="bg-indigo-600 hover:bg-indigo-500 active:scale-[0.97] text-white text-sm px-4 py-2 rounded-lg transition-all duration-150 shadow-sm"
                >
                  Post
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">All posts ({posts.length})</h2>
        {posts.length === 0 ? (
          <p className="text-gray-500 dark:text-zinc-500 text-sm">No posts yet.</p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <div key={post.id} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white">{post.creative.idea.title}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-500 dark:text-zinc-500 capitalize">{post.platform}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${POST_STATUS_COLORS[post.status] ?? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                      {post.status}
                    </span>
                    {post.scheduledAt && (
                      <span className="text-xs text-gray-500 dark:text-zinc-500">
                        Scheduled: {new Date(post.scheduledAt).toLocaleString()}
                      </span>
                    )}
                    {post.postedAt && (
                      <span className="text-xs text-gray-500 dark:text-zinc-500">
                        Posted: {new Date(post.postedAt).toLocaleString()}
                      </span>
                    )}
                    {post.externalPostId && (
                      <span className="text-xs text-gray-400 dark:text-zinc-600 font-mono">{post.externalPostId.slice(0, 12)}...</span>
                    )}
                  </div>
                </div>
                {post.status === 'queued' && (
                  <button
                    onClick={() => handlePublishNow(post.id)}
                    disabled={posting === post.id}
                    className="text-sm border border-gray-200 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500 text-gray-600 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {posting === post.id ? 'Publishing...' : 'Publish now'}
                  </button>
                )}
                {post.status === 'failed' && (
                  <button
                    onClick={() => handlePublishNow(post.id)}
                    className="text-sm bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Retry
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {confirmCreative && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/60">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Post &ldquo;{confirmCreative.idea.title}&rdquo;
              </h3>
              <button
                onClick={() => setConfirmCreative(null)}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors mt-0.5"
              >
                <CloseIcon />
              </button>
            </div>

            <div>
              <label className="text-sm text-gray-600 dark:text-zinc-400 block mb-2">Platforms</label>
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
                    <span className="text-sm text-gray-700 dark:text-zinc-300 capitalize">{p}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-gray-600 dark:text-zinc-400 block mb-2">
                Schedule <span className="text-gray-400 dark:text-zinc-600">(leave empty to post now)</span>
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
              />
            </div>

            {error && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmCreative(null)}
                className="flex-1 border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 py-2 rounded-lg text-sm hover:border-gray-300 dark:hover:border-zinc-600 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={!!posting || selectedPlatforms.length === 0}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-all duration-150"
              >
                {posting ? 'Posting...' : scheduledAt ? 'Schedule' : 'Post now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
