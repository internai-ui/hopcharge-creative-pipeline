import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { getVideoGenerator } from '@/lib/plugins/registry'
import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { ideaId, generator: generatorOverride, regenerate } = await req.json()

    const idea = await prisma.idea.findUnique({ where: { id: ideaId } })
    if (!idea) return Response.json({ error: 'Idea not found' }, { status: 404 })

    // Regenerate: cancel + delete any existing creatives for this idea first
    if (regenerate) {
      const existingCreatives = await prisma.creative.findMany({
        where: { ideaId },
        include: { posts: { include: { snapshots: true } } },
      })

      const generator = getVideoGenerator()
      for (const c of existingCreatives) {
        if (c.status === 'generating' && c.generatorJobId && generator.cancelJob) {
          await generator.cancelJob(c.generatorJobId).catch(() => {})
        }
        const postIds = c.posts.map(p => p.id)
        if (postIds.length > 0) {
          await prisma.performanceSnapshot.deleteMany({ where: { postId: { in: postIds } } })
          await prisma.post.deleteMany({ where: { id: { in: postIds } } })
        }
        for (const p of [c.originalFilePath, c.editedFilePath, c.thumbnailPath]) {
          if (p) await storage.delete(p).catch(() => {})
        }
        await prisma.creative.delete({ where: { id: c.id } })
      }
    }

    const generator = getVideoGenerator()
    const { jobId } = await generator.submitJob({ idea })

    const creative = await prisma.creative.create({
      data: {
        ideaId,
        status: 'generating',
        generatorName: generatorOverride ?? generator.name,
        generatorJobId: jobId,
      },
    })

    await prisma.idea.update({
      where: { id: ideaId },
      data: { status: 'in_production' },
    })

    return Response.json(creative, { status: 201 })
  } catch (err) {
    return Response.json({ error: 'Failed to generate creative', details: String(err) }, { status: 500 })
  }
}
