import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { NextRequest } from 'next/server'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const creative = await prisma.creative.update({
      where: { id },
      data: {
        status: body.status,
        metadata: body.metadata,
      },
    })

    if (body.status === 'approved') {
      await prisma.agentAction.create({
        data: {
          actionType: 'creative_selected',
          decisionRationale: `Creative ${id} approved for publishing`,
          relatedEntityId: id,
        },
      })
    }

    return Response.json(creative)
  } catch (err) {
    return Response.json({ error: 'Failed to update creative', details: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const creative = await prisma.creative.findUnique({
      where: { id },
      include: { posts: { include: { snapshots: true } }, idea: true },
    })
    if (!creative) return Response.json({ error: 'Creative not found' }, { status: 404 })

    // Cascade: snapshots → posts → creative
    const postIds = creative.posts.map(p => p.id)
    if (postIds.length > 0) {
      await prisma.performanceSnapshot.deleteMany({ where: { postId: { in: postIds } } })
      await prisma.post.deleteMany({ where: { id: { in: postIds } } })
    }

    // Delete local files
    for (const path of [creative.originalFilePath, creative.editedFilePath, creative.thumbnailPath]) {
      if (path) await storage.delete(path).catch(() => {})
    }

    await prisma.creative.delete({ where: { id } })

    // Revert idea to selected if it was in_production and this was its only creative
    const remaining = await prisma.creative.count({ where: { ideaId: creative.ideaId } })
    if (remaining === 0 && creative.idea.status === 'in_production') {
      await prisma.idea.update({ where: { id: creative.ideaId }, data: { status: 'selected' } })
    }

    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: 'Failed to delete creative', details: String(err) }, { status: 500 })
  }
}
