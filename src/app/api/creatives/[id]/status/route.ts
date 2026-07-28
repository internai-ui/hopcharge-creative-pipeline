import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { getVideoGenerator, getImageGenerator } from '@/lib/plugins/registry'
import { downloadImageBuffer } from '@/lib/download'
import { overlayLogo, logoOverlayEnabled } from '@/lib/logo-overlay'
import { overlayLogoOnVideo, videoLogoOverlayEnabled } from '@/lib/video-logo-overlay'
import { overlayHeadline, headlineOverlayEnabled } from '@/lib/headline-overlay'
import { overlayHeadlineOnVideo, videoHeadlineOverlayEnabled } from '@/lib/video-headline-overlay'
import { appendOutroClip, outroClipEnabled } from '@/lib/video-append-clip'
import { NextRequest } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const creative = await prisma.creative.findUnique({ where: { id }, include: { idea: true } })
    if (!creative) return Response.json({ error: 'Creative not found' }, { status: 404 })

    if (creative.status !== 'generating' || !creative.generatorJobId) {
      return Response.json({ status: creative.status, creative })
    }

    // Image creatives generated via an async generator (e.g. Higgsfield) are polled
    // through the image generator and downloaded with their real extension.
    if (creative.mediaType === 'image') {
      const imageGen = getImageGenerator()
      if (!imageGen.pollJobStatus) return Response.json({ status: creative.status, creative })

      const result = await imageGen.pollJobStatus(creative.generatorJobId)
      if (result.status === 'complete' && result.fileUrls?.[0]) {
        const { buffer, ext } = await downloadImageBuffer(result.fileUrls[0])
        // The van is rendered unbranded; stamp the real Hopcharge logo here for a consistent mark.
        const logoBuffer = logoOverlayEnabled() ? await overlayLogo(buffer) : buffer
        // Composite the headline band so the ad carries its own on-image message.
        const finalBuffer = headlineOverlayEnabled() ? await overlayHeadline(logoBuffer, creative.idea.headline) : logoBuffer
        const filePath = `creatives/${creative.id}/original.${ext}`
        await storage.save(filePath, finalBuffer)
        const updated = await prisma.creative.update({
          where: { id },
          data: { status: 'ready_for_review', originalFilePath: filePath },
        })
        return Response.json({ status: 'ready_for_review', creative: updated })
      }
      if (result.status === 'failed') {
        const updated = await prisma.creative.update({
          where: { id },
          data: { status: 'rejected', metadata: { error: result.error } },
        })
        return Response.json({ status: 'rejected', error: result.error, creative: updated })
      }
      return Response.json({ status: result.status, creative })
    }

    const generator = getVideoGenerator()
    const meta = (creative.metadata as { landscapeJobId?: string } | null) ?? {}

    // Portrait (9:16) job - the primary. A failure fails the whole creative.
    const result = await generator.pollJobStatus(creative.generatorJobId)
    if (result.status === 'failed') {
      const updated = await prisma.creative.update({
        where: { id },
        data: { status: 'rejected', metadata: { error: result.error } },
      })
      return Response.json({ status: 'rejected', error: result.error, creative: updated })
    }

    // Download the portrait once ready (guarded so repeat polls don't re-download).
    let originalFilePath = creative.originalFilePath
    if (result.status === 'complete' && result.fileUrl && !originalFilePath) {
      const buffer = Buffer.from(await (await fetch(result.fileUrl)).arrayBuffer())
      // The van is rendered unbranded; burn the real Hopcharge logo onto the frames.
      const logoBuffer = videoLogoOverlayEnabled() ? await overlayLogoOnVideo(buffer) : buffer
      // Composite the headline band onto every frame so the ad carries its own message.
      const headlinedBuffer = videoHeadlineOverlayEnabled() ? await overlayHeadlineOnVideo(logoBuffer, creative.idea.headline) : logoBuffer
      // Append the outro clip after the headline band is baked in, so the outro never gets captioned.
      const finalBuffer = outroClipEnabled() ? await appendOutroClip(headlinedBuffer) : headlinedBuffer
      originalFilePath = `creatives/${creative.id}/original.mp4`
      await storage.save(originalFilePath, finalBuffer)
    }

    // Landscape (16:9) job for YouTube "both" - best-effort. A failure just ships the
    // Shorts version; still-rendering keeps the creative in "generating".
    let landscapeFilePath = creative.landscapeFilePath
    let landscapePending = false
    if (meta.landscapeJobId && !landscapeFilePath) {
      const land = await generator.pollJobStatus(meta.landscapeJobId)
      if (land.status === 'complete' && land.fileUrl) {
        const buffer = Buffer.from(await (await fetch(land.fileUrl)).arrayBuffer())
        landscapeFilePath = `creatives/${creative.id}/landscape.mp4`
        await storage.save(landscapeFilePath, buffer)
      } else if (land.status !== 'failed') {
        landscapePending = true
      }
    }

    // Ready once the portrait is in and the landscape isn't still rendering.
    if (originalFilePath && !landscapePending) {
      const updated = await prisma.creative.update({
        where: { id },
        data: { status: 'ready_for_review', originalFilePath, landscapeFilePath },
      })
      return Response.json({ status: 'ready_for_review', creative: updated })
    }

    // Persist partial downloads so we don't fetch them twice, and report progress.
    if (originalFilePath !== creative.originalFilePath || landscapeFilePath !== creative.landscapeFilePath) {
      await prisma.creative.update({ where: { id }, data: { originalFilePath, landscapeFilePath } })
    }
    return Response.json({ status: landscapePending ? 'processing' : result.status, creative })
  } catch (err) {
    return Response.json({ error: 'Failed to get status', details: String(err) }, { status: 500 })
  }
}
