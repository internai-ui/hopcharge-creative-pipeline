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
        videoFirstFrame: body.videoFirstFrame,
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

    // Load just the ids/paths needed to cascade-delete and clean up files.
    const creatives = await prisma.creative.findMany({
      where: { ideaId: id },
      select: {
        id: true,
        originalFilePath: true,
        editedFilePath: true,
        thumbnailPath: true,
        posts: { select: { id: true } },
      },
    })

    const creativeIds = creatives.map(c => c.id)
    const postIds = creatives.flatMap(c => c.posts.map(p => p.id))
    const filePaths = creatives.flatMap(c => [c.originalFilePath, c.editedFilePath, c.thumbnailPath])
      .filter((p): p is string => !!p)

    // Cascade the whole subtree in one batched, atomic transaction
    // (snapshots → posts → creatives → idea) instead of per-creative round trips.
    await prisma.$transaction([
      ...(postIds.length ? [prisma.performanceSnapshot.deleteMany({ where: { postId: { in: postIds } } })] : []),
      ...(postIds.length ? [prisma.post.deleteMany({ where: { id: { in: postIds } } })] : []),
      ...(creativeIds.length ? [prisma.creative.deleteMany({ where: { id: { in: creativeIds } } })] : []),
      prisma.idea.delete({ where: { id } }),
    ])

    // File cleanup is best-effort and external to the DB - run in parallel.
    await Promise.all(filePaths.map(path => storage.delete(path).catch(() => {})))

    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: 'Failed to delete idea', details: String(err) }, { status: 500 })
  }
}
