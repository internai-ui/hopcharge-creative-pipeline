import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { getVideoGenerator, getImageGenerator } from '@/lib/plugins/registry'
import { downloadImageBuffer } from '@/lib/download'

const THIRTY_MINUTES = 30 * 60 * 1000

export async function pollCreativeStatus(): Promise<void> {
  const generating = await prisma.creative.findMany({
    where: { status: 'generating', generatorJobId: { not: null } },
  })

  const videoGenerator = getVideoGenerator()
  const imageGenerator = getImageGenerator()

  for (const creative of generating) {
    try {
      const jobId = creative.generatorJobId!

      // Image jobs (async generators like Higgsfield) poll + download differently
      // from video - use the right generator and the image's real extension.
      if (creative.mediaType === 'image') {
        if (!imageGenerator.pollJobStatus) continue
        const result = await imageGenerator.pollJobStatus(jobId)
        if (result.status === 'complete' && result.fileUrls?.[0]) {
          const { buffer, ext } = await downloadImageBuffer(result.fileUrls[0])
          const filePath = `creatives/${creative.id}/original.${ext}`
          await storage.save(filePath, buffer)
          await prisma.creative.update({
            where: { id: creative.id },
            data: { status: 'ready_for_review', originalFilePath: filePath },
          })
        } else if (result.status === 'failed') {
          await prisma.creative.update({
            where: { id: creative.id },
            data: { status: 'rejected', metadata: { error: result.error } },
          })
          await logIssue('production', `Image generation failed for creative ${creative.id}: ${result.error}`, 'warning', creative.id)
        } else {
          const age = Date.now() - creative.createdAt.getTime()
          if (age > THIRTY_MINUTES) {
            await logIssue('production', `Creative ${creative.id} has been generating for over 30 minutes`, 'critical', creative.id)
          }
        }
        continue
      }

      const result = await videoGenerator.pollJobStatus(jobId)

      if (result.status === 'complete' && result.fileUrl) {
        // Download file to storage
        const response = await fetch(result.fileUrl)
        const buffer = Buffer.from(await response.arrayBuffer())
        const filePath = `creatives/${creative.id}/original.mp4`
        await storage.save(filePath, buffer)

        await prisma.creative.update({
          where: { id: creative.id },
          data: {
            status: 'ready_for_review',
            originalFilePath: filePath,
          },
        })
      } else if (result.status === 'failed') {
        await prisma.creative.update({
          where: { id: creative.id },
          data: { status: 'rejected', metadata: { error: result.error } },
        })
        await logIssue('production', `Video generation failed for creative ${creative.id}: ${result.error}`, 'warning', creative.id)
      } else {
        // Still pending/processing - check for timeout
        const age = Date.now() - creative.createdAt.getTime()
        if (age > THIRTY_MINUTES) {
          await logIssue('production', `Creative ${creative.id} has been generating for over 30 minutes`, 'critical', creative.id)
        }
      }
    } catch (err) {
      await logIssue('production', `Error polling creative ${creative.id}: ${String(err)}`, 'warning', creative.id)
    }
  }
}

async function logIssue(
  stage: string,
  description: string,
  severity: 'info' | 'warning' | 'critical',
  entityId?: string
) {
  await prisma.pipelineIssue.create({
    data: {
      severity,
      stage: stage as never,
      description,
      relatedEntityId: entityId,
      isResolved: false,
    },
  })
}
