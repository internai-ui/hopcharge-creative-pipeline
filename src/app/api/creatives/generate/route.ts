import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { getVideoGenerator, getImageGenerator } from '@/lib/plugins/registry'
import { buildImagePrompt, deriveFirstFrameVisual } from '@/lib/plugins/prompt-constants'
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

    // Credit safety: don't submit a second video job for an idea that already has a
    // live one - a duplicate submission burns generation credits for nothing.
    if (!regenerate) {
      const active = await prisma.creative.findFirst({
        where: { ideaId, mediaType: 'video', status: { in: ['generating', 'ready_for_review', 'approved', 'published'] } },
      })
      if (active) return Response.json(active, { status: 200 })
    }

    const generator = getVideoGenerator()

    // Image2video generators need an OPENING FRAME, not the finished image ad. Render a
    // dedicated first frame from the idea's videoFirstFrame prompt (Sara-locked via the
    // image generator) so each video is dynamically generated yet character-consistent.
    // Higgsfield's API and the browser UIs (Kling/Runway/Veo all support image-to-video)
    // can all use it; text2video generators ignore it.
    const IMG2VIDEO = new Set(['higgsfield', 'browser-kling', 'browser-runway', 'browser-veo'])
    let referenceAssets: string[] | undefined
    if (IMG2VIDEO.has(generator.name)) {
      const framePrompt = buildImagePrompt(
        idea.videoFirstFrame?.trim() || deriveFirstFrameVisual(idea.videoVisual),
        { angle: idea.angle }
      )
      try {
        const frame = await getImageGenerator().generate({ prompt: framePrompt })
        if (frame.fileUrl) referenceAssets = [frame.fileUrl]
      } catch (err) {
        // Higgsfield image2video REQUIRES a frame, so surface the failure there. The
        // browser generators degrade gracefully to text-to-video, so just log.
        if (generator.name === 'higgsfield') throw err
        console.warn(`[creatives] first-frame render failed for ${generator.name}, falling back to text-to-video:`, err)
      }
    }

    const { jobId } = await generator.submitJob({ idea, referenceAssets })

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
