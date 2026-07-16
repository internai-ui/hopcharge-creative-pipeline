import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { getVideoGenerator, getImageGenerator } from '@/lib/plugins/registry'
import { buildImagePrompt, buildVideoPrompt, deriveFirstFrameVisual } from '@/lib/plugins/prompt-constants'
import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { ideaId, generator: generatorOverride, regenerate, platform, manual } = await req.json()
    const targetPlatform: 'meta' | 'youtube' = platform === 'youtube' ? 'youtube' : 'meta'
    // The Ideas-page toggle sends an explicit boolean that overrides the env default.
    const useManual = typeof manual === 'boolean' ? manual : process.env.VIDEO_GENERATOR === 'manual'

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
        where: { ideaId, mediaType: 'video', status: { in: ['generating', 'awaiting_upload', 'ready_for_review', 'approved', 'published'] } },
      })
      if (active) return Response.json(active, { status: 200 })
    }

    // Manual (copy-paste) mode: no video-generation API available. Build the full
    // prompt + the opening-frame prompt (Higgsfield image2video needs a first frame),
    // stash them on the creative, and park it in `awaiting_upload` for the Review page
    // to hand off (copy → generate externally → upload the result back in).
    if (useManual) {
      const prompt = buildVideoPrompt(idea.videoVisual)
      const firstFramePrompt = buildImagePrompt(
        idea.videoFirstFrame?.trim() || deriveFirstFrameVisual(idea.videoVisual),
        { angle: idea.angle },
      )
      const creative = await prisma.creative.create({
        data: {
          ideaId,
          platform: targetPlatform,
          aspectRatio: '9:16',
          mediaType: 'video',
          status: 'awaiting_upload',
          generatorName: 'manual',
          metadata: { manual: { tool: 'higgsfield', mediaType: 'video', aspectRatio: '9:16', prompt, firstFramePrompt } },
        },
      })
      await prisma.idea.update({ where: { id: ideaId }, data: { status: 'in_production' } })
      return Response.json(creative, { status: 201 })
    }

    const generator = getVideoGenerator()

    // Image2video generators need an OPENING FRAME, not the finished image ad. Render a
    // dedicated first frame from the idea's videoFirstFrame prompt (Sara-locked via the
    // image generator) so each video is dynamically generated yet character-consistent.
    // Higgsfield's image2video uses it; text2video generators ignore it.
    const IMG2VIDEO = new Set(['higgsfield'])
    let referenceAssets: string[] | undefined
    if (IMG2VIDEO.has(generator.name)) {
      const framePrompt = buildImagePrompt(
        idea.videoFirstFrame?.trim() || deriveFirstFrameVisual(idea.videoVisual),
        { angle: idea.angle }
      )
      // Higgsfield image2video REQUIRES a frame, so a failure here is fatal.
      const frame = await getImageGenerator().generate({ prompt: framePrompt })
      if (frame.fileUrl) referenceAssets = [frame.fileUrl]
    }

    const { jobId } = await generator.submitJob({ idea, referenceAssets, aspectRatio: '9:16' })

    // YouTube "both": also render a 16:9 in-stream rendition alongside the 9:16
    // Shorts video; both ship as assets in one Demand Gen responsive ad. Best-effort
    // — if the landscape submit fails we still publish the Shorts version.
    let landscapeJobId: string | undefined
    if (targetPlatform === 'youtube') {
      try {
        const land = await generator.submitJob({ idea, referenceAssets, aspectRatio: '16:9' })
        landscapeJobId = land.jobId
      } catch (err) {
        console.warn('[creatives] 16:9 landscape submit failed, continuing Shorts-only:', err)
      }
    }

    const creative = await prisma.creative.create({
      data: {
        ideaId,
        platform: targetPlatform,
        aspectRatio: '9:16',
        status: 'generating',
        generatorName: generatorOverride ?? generator.name,
        generatorJobId: jobId,
        ...(landscapeJobId ? { metadata: { landscapeJobId } } : {}),
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
