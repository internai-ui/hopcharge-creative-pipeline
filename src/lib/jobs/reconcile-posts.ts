import { prisma } from '@/lib/db'

const BASE = 'https://graph.facebook.com/v21.0'

// Real Meta ad IDs are all-numeric. Seed/stub posts use ids like
// "act_123..._post_001" or "stub-post-..." - skip those so we never flag
// non-Meta posts as deleted.
function isRealMetaAdId(id: string): boolean {
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

/**
 * Reconcile our published Meta posts against Ads Manager. If an ad was deleted
 * on Meta's side, mark the local post as "deleted" so the Publish Queue reflects
 * it. Returns the ids of posts newly marked deleted.
 */
export async function reconcilePosts(): Promise<{ checked: number; deletedPostIds: string[] }> {
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
    if (!isRealMetaAdId(adId)) continue
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
