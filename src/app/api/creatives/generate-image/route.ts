import { prisma } from '@/lib/db'
import { getImageGenerator } from '@/lib/plugins/registry'
import { storage } from '@/lib/storage'
import { buildImagePrompt } from '@/lib/plugins/prompt-constants'
import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

async function readImageBuffer(fileUrl: string): Promise<{ buffer: Buffer; ext: string }> {
  // Browser-based generators save to local storage and return a relative path like
  // /api/browser-images/flux-xxx.webp - read from disk instead of fetching via HTTP
  if (fileUrl.startsWith('/api/browser-images/')) {
    const filename = fileUrl.replace('/api/browser-images/', '')
    const localPath = path.join(process.cwd(), 'storage', 'browser-images', filename)
    if (!fs.existsSync(localPath)) throw new Error(`Browser image not found at ${localPath}`)
    const ext = filename.split('.').pop() ?? 'jpg'
    return { buffer: fs.readFileSync(localPath), ext }
  }

  // API-based generators (Replicate, etc.) return a full https:// CDN URL
  const response = await fetch(fileUrl)
  if (!response.ok) throw new Error(`Failed to download image: ${response.status} ${fileUrl}`)
  const contentType = response.headers.get('content-type') ?? ''
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
  return { buffer: Buffer.from(await response.arrayBuffer()), ext }
}

export async function POST(req: NextRequest) {
  try {
    const { ideaId, regenerate } = await req.json()

    const idea = await prisma.idea.findUnique({ where: { id: ideaId } })
    if (!idea) return Response.json({ error: 'Idea not found' }, { status: 404 })

    // Regenerate: delete existing image creatives for this idea first
    if (regenerate) {
      const existing = await prisma.creative.findMany({
        where: { ideaId, mediaType: 'image' },
        include: { posts: { include: { snapshots: true } } },
      })
      for (const c of existing) {
        const postIds = c.posts.map(p => p.id)
        if (postIds.length > 0) {
          await prisma.performanceSnapshot.deleteMany({ where: { postId: { in: postIds } } })
          await prisma.post.deleteMany({ where: { id: { in: postIds } } })
        }
        for (const p of [c.originalFilePath, c.editedFilePath]) {
          if (p) await storage.delete(p).catch(() => {})
        }
        await prisma.creative.delete({ where: { id: c.id } })
      }
    }

    const generator = getImageGenerator()
    const prompt = buildImagePrompt(idea.imageVisual, { angle: idea.angle })

    // Async path: for generators that support it (e.g. Higgsfield), submit the job
    // and return immediately with a "generating" creative. A poller (the Review page
    // auto-poll + poll-creative-status job) downloads the image once it's ready, so
    // this request never blocks for the full generation time.
    if (generator.submitJob) {
      const { jobId } = await generator.submitJob({ prompt })
      const creative = await prisma.creative.create({
        data: {
          ideaId,
          mediaType: 'image',
          status: 'generating',
          generatorName: generator.name,
          generatorJobId: jobId,
        },
      })
      await prisma.idea.update({ where: { id: ideaId }, data: { status: 'in_production' } })
      await prisma.agentAction.create({
        data: {
          actionType: 'image_generation_started',
          decisionRationale: `Image generation queued for idea "${idea.title}" via ${generator.name} (job ${jobId})`,
          relatedEntityId: creative.id,
        },
      })
      return Response.json([creative], { status: 201 })
    }

    // Synchronous path (Replicate / browser / stub): blocks until the image returns.
    const { fileUrl, fileUrls } = await generator.generate({ prompt })

    // Use all image URLs if available (e.g. ElevenLabs returns 4), otherwise just the one
    const allUrls = fileUrls && fileUrls.length > 1 ? fileUrls : [fileUrl]
    const creatives = []

    for (const url of allUrls) {
      const { buffer, ext } = await readImageBuffer(url)

      const creative = await prisma.creative.create({
        data: {
          ideaId,
          mediaType: 'image',
          status: 'ready_for_review',
          generatorName: generator.name,
        },
      })

      const filePath = `creatives/${creative.id}/original.${ext}`
      await storage.save(filePath, buffer)

      await prisma.creative.update({
        where: { id: creative.id },
        data: { originalFilePath: filePath },
      })

      creatives.push({ ...creative, originalFilePath: filePath })
    }

    await prisma.idea.update({
      where: { id: ideaId },
      data: { status: 'in_production' },
    })

    await prisma.agentAction.create({
      data: {
        actionType: 'image_generated',
        decisionRationale: `${creatives.length} image(s) generated for idea "${idea.title}" using ${generator.name}`,
        relatedEntityId: creatives[0].id,
      },
    })

    return Response.json(creatives, { status: 201 })
  } catch (err) {
    return Response.json({ error: 'Image generation failed', details: String(err) }, { status: 500 })
  }
}
