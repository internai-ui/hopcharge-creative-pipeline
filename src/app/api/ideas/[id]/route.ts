import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { NextRequest } from 'next/server'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const idea = await prisma.idea.update({
      where: { id },
      data: {
        title: body.title,
        hook: body.hook,
        imageVisual: body.imageVisual,
        videoVisual: body.videoVisual,
        cta: body.cta,
        angle: body.angle,
        funnelStage: body.funnelStage,
        rank: body.rank,
        status: body.status,
        nudge: body.nudge,
        trendTags: body.trendTags,
      },
    })
    return Response.json(idea)
  } catch (err) {
    return Response.json({ error: 'Failed to update idea', details: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Load all related data needed to cascade-delete and clean up files
    const creatives = await prisma.creative.findMany({
      where: { ideaId: id },
      include: { posts: { include: { snapshots: true } } },
    })

    for (const creative of creatives) {
      // Delete performance snapshots
      const postIds = creative.posts.map(p => p.id)
      if (postIds.length > 0) {
        await prisma.performanceSnapshot.deleteMany({ where: { postId: { in: postIds } } })
        await prisma.post.deleteMany({ where: { id: { in: postIds } } })
      }

      // Delete local video files
      for (const path of [creative.originalFilePath, creative.editedFilePath, creative.thumbnailPath]) {
        if (path) await storage.delete(path).catch(() => {})
      }

      await prisma.creative.delete({ where: { id: creative.id } })
    }

    await prisma.idea.delete({ where: { id } })
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: 'Failed to delete idea', details: String(err) }, { status: 500 })
  }
}
