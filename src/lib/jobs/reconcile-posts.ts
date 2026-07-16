import { prisma } from '@/lib/db'
import { googleAdsConfigured, googleAdsAccessToken, googleAdsSearch } from '@/lib/plugins/google-ads/client'

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

// One GAQL row from the ad-status query.
interface AdStatusRow {
  adGroupAd?: { status?: string; ad?: { id?: string } }
}

/**
 * Reconcile published YouTube (Google Ads Demand Gen) posts. A Demand Gen ad that
 * was removed in Google Ads reports `ad_group_ad.status = REMOVED`; we mark the
 * local post "deleted" to mirror the Meta reconcile. Absence from the result set is
 * treated as transient (not deletion), so a query hiccup never wrongly flags an ad.
 */
async function reconcileYouTubePosts(): Promise<ReconcileResult> {
  const deletedPostIds: string[] = []

  // Only meaningful when Google Ads credentials are configured.
  if (!googleAdsConfigured()) return { checked: 0, deletedPostIds }

  const posts = await prisma.post.findMany({
    where: { status: 'posted', platform: 'youtube', externalPostId: { not: null } },
    select: { id: true, externalPostId: true },
  })
  const ids = posts.map((p) => p.externalPostId!).filter(isRealNumericAdId)
  if (ids.length === 0) return { checked: 0, deletedPostIds }

  const statusById = new Map<string, string>()
  try {
    const token = await googleAdsAccessToken()
    const idList = ids.map((id) => `'${id}'`).join(', ')
    const rows = await googleAdsSearch<AdStatusRow>(
      `SELECT ad_group_ad.ad.id, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${idList})`,
      token,
    )
    for (const r of rows) {
      const id = r.adGroupAd?.ad?.id
      if (id) statusById.set(String(id), r.adGroupAd?.status ?? '')
    }
  } catch {
    // Network/transient error - leave posts untouched, try again next run.
    return { checked: 0, deletedPostIds }
  }

  let checked = 0
  for (const post of posts) {
    const adId = post.externalPostId!
    if (!isRealNumericAdId(adId)) continue
    checked++
    if (statusById.get(adId) === 'REMOVED') {
      await prisma.post.update({ where: { id: post.id }, data: { status: 'deleted' } })
      deletedPostIds.push(post.id)
      await prisma.agentAction.create({
        data: {
          actionType: 'post_deleted_on_youtube',
          decisionRationale: `Ad ${adId} (post ${post.id}) was removed in Google Ads - marked deleted in the pipeline.`,
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
