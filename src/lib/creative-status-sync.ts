import { prisma } from './db'

/**
 * Single source of truth for "is this creative's ad actually live right now": a post
 * row with status 'posted'. creative.status flips to 'published' when a post goes
 * live (see publish/route.ts) but nothing previously reverted it when that post later
 * went away - deleted from our queue, or marked 'deleted' after reconcile found it
 * removed upstream. A creative stuck at 'published' with no live post is invisible to
 * every page that reads creative.status (the Publish page's "approved" queue can never
 * show it again, so it can't be re-posted without manual DB surgery).
 *
 * Call this after ANY post leaves the 'posted' state without a replacement taking its
 * place - delete, or reconcile marking it deleted - so creative.status (and everything
 * downstream of it) reflects reality again.
 */
export async function syncCreativeStatusAfterPostRemoval(creativeId: string): Promise<void> {
  const stillLive = await prisma.post.findFirst({
    where: { creativeId, status: 'posted' },
    select: { id: true },
  })
  if (stillLive) return

  await prisma.creative.updateMany({
    where: { id: creativeId, status: 'published' },
    data: { status: 'approved' },
  })
}
