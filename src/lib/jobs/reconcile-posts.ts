import { prisma } from '@/lib/db'
import { youtubeConfigured, youtubeAccessToken, youtubeGet, chunk, isRealYouTubeVideoId } from '@/lib/plugins/youtube/client'

const BASE = 'https://graph.facebook.com/v21.0'

// Real Meta/Google ad IDs are all-numeric. Seed/stub posts use ids like
// "act_123..._post_001" or "stub-post-..." - skip those so we never flag
// non-real posts as deleted.
function isRealNumericAdId(id: string): boolean {
  return /^\d+$/.test(id)
}

// True when a Graph API response for an ad indicates it no longer exists -
// either an explicit DELETED status, or a "does not exist" error (code 100)
// that Meta returns once an ad is deleted in Ads Manager.
function looksDeleted(data: {
  id?: string
  effective_status?: string
  error?: { code?: number; message?: string }
}): boolean {
  if (data.effective_status === 'DELETED') return true
  if (data.error) {
    const msg = data.error.message ?? ''
    if (data.error.code === 100 && /does not exist|nonexisting|Object with ID/i.test(msg)) return true
  }
  return false
}

type ReconcileResult = { checked: number; deletedPostIds: string[] }

/**
 * Reconcile published Meta posts against Ads Manager. If an ad was deleted on
 * Meta's side, mark the local post "deleted" so the Publish Queue reflects it.
 */
async function reconcileMetaPosts(): Promise<ReconcileResult> {
  const token = process.env.META_ACCESS_TOKEN
  const deletedPostIds: string[] = []

  // Only meaningful for live Meta posts we have a token for.
  if (!token) return { checked: 0, deletedPostIds }

  const posts = await prisma.post.findMany({
    where: { status: 'posted', platform: 'meta', externalPostId: { not: null } },
    select: { id: true, externalPostId: true },
  })

  let checked = 0
  for (const post of posts) {
    const adId = post.externalPostId!
    if (!isRealNumericAdId(adId)) continue
    checked++
    try {
      const res = await fetch(`${BASE}/${adId}?fields=id,effective_status&access_token=${token}`)
      const data = await res.json()
      if (looksDeleted(data)) {
        await prisma.post.update({ where: { id: post.id }, data: { status: 'deleted' } })
        deletedPostIds.push(post.id)
        await prisma.agentAction.create({
          data: {
            actionType: 'post_deleted_on_meta',
            decisionRationale: `Ad ${adId} (post ${post.id}) was deleted in Meta Ads Manager - marked deleted in the pipeline.`,
            relatedEntityId: post.id,
          },
        })
      }
    } catch {
      // Network/transient error - leave the post untouched, try again next run.
    }
  }

  return { checked, deletedPostIds }
}

/**
 * Reconcile published YouTube posts against the channel. We ask the Data API which
 * of our video ids still exist (videos.list?part=id); owner-authenticated list
 * returns private videos too, so an id MISSING from the response genuinely means the
 * video was deleted (or pulled for a strike). A failed query is treated as transient
 * (no deletions that run), so a hiccup never wrongly flags a video.
 */
async function reconcileYouTubePosts(): Promise<ReconcileResult> {
  const deletedPostIds: string[] = []

  // Only meaningful when the YouTube Data API credentials are configured.
  if (!youtubeConfigured()) return { checked: 0, deletedPostIds }

  const posts = await prisma.post.findMany({
    where: { status: 'posted', platform: 'youtube', externalPostId: { not: null } },
    select: { id: true, externalPostId: true },
  })
  const ids = posts.map((p) => p.externalPostId!).filter(isRealYouTubeVideoId)
  if (ids.length === 0) return { checked: 0, deletedPostIds }

  const existing = new Set<string>()
  try {
    const token = await youtubeAccessToken()
    for (const group of chunk(ids, 50)) {
      const data = await youtubeGet<{ items?: { id?: string }[] }>(
        'videos',
        { part: 'id', id: group.join(','), maxResults: '50' },
        token,
      )
      for (const item of data.items ?? []) if (item.id) existing.add(item.id)
    }
  } catch {
    // Network/transient error - leave posts untouched, try again next run.
    return { checked: 0, deletedPostIds }
  }

  let checked = 0
  for (const post of posts) {
    const videoId = post.externalPostId!
    if (!isRealYouTubeVideoId(videoId)) continue
    checked++
    if (!existing.has(videoId)) {
      await prisma.post.update({ where: { id: post.id }, data: { status: 'deleted' } })
      deletedPostIds.push(post.id)
      await prisma.agentAction.create({
        data: {
          actionType: 'post_deleted_on_youtube',
          decisionRationale: `Video ${videoId} (post ${post.id}) no longer exists on YouTube - marked deleted in the pipeline.`,
          relatedEntityId: post.id,
        },
      })
    }
  }

  return { checked, deletedPostIds }
}

/**
 * Reconcile published posts across BOTH platforms against their ad managers, marking
 * any upstream-deleted ad "deleted" locally. Returns the combined tally.
 */
export async function reconcilePosts(): Promise<ReconcileResult> {
  const meta = await reconcileMetaPosts()
  const youtube = await reconcileYouTubePosts()
  return {
    checked: meta.checked + youtube.checked,
    deletedPostIds: [...meta.deletedPostIds, ...youtube.deletedPostIds],
  }
}
