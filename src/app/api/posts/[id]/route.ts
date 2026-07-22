import { prisma } from '@/lib/db'
import { getPublisher } from '@/lib/plugins/registry'
import { explainError } from '@/lib/error-guidance'
import { syncCreativeStatusAfterPostRemoval } from '@/lib/creative-status-sync'
import { NextRequest } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const post = await prisma.post.findUnique({
      where: { id },
      include: { creative: { include: { idea: true } }, snapshots: { orderBy: { snapshotDate: 'desc' } } },
    })
    if (!post) return Response.json({ error: 'Post not found' }, { status: 404 })
    return Response.json(post)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch post', details: String(err) }, { status: 500 })
  }
}

// Deletes the post row AND, if it's still live on its platform, the ad/video itself -
// distinct from pause (which just stops delivery/hides it, leaving the object in
// place upstream). A post that was already reconciled as deleted upstream (status
// 'deleted') or never published (no externalPostId) skips the platform call.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const post = await prisma.post.findUnique({ where: { id } })
    if (!post) return Response.json({ error: 'Post not found' }, { status: 404 })

    if (post.externalPostId && post.status !== 'deleted') {
      try {
        await getPublisher(post.platform).delete(post.externalPostId)
      } catch (err) {
        // Don't silently drop the DB row while the ad is still live upstream - the
        // user needs to know the platform delete failed so they can retry or go
        // remove it manually.
        const g = explainError(String(err), { platform: post.platform })
        return Response.json(
          { error: `Failed to delete on ${post.platform}`, reason: g.reason, actions: g.actions },
          { status: 502 },
        )
      }
    }

    // Snapshots have no cascade delete - clear them first or the FK constraint
    // blocks removing a post that has synced performance data.
    await prisma.$transaction([
      prisma.performanceSnapshot.deleteMany({ where: { postId: id } }),
      prisma.post.delete({ where: { id } }),
    ])

    // Single source of truth: the creative's own status must stop claiming
    // 'published' once its last live post is gone, or it becomes invisible to the
    // Publish page's "approved" queue forever - see creative-status-sync.ts.
    await syncCreativeStatusAfterPostRemoval(post.creativeId)

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: 'Failed to delete post', details: String(err) }, { status: 500 })
  }
}
