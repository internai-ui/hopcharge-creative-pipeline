import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { getVideoGenerator } from '@/lib/plugins/registry'
import { NextRequest } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const creative = await prisma.creative.findUnique({ where: { id } })
    if (!creative) return Response.json({ error: 'Creative not found' }, { status: 404 })

    if (creative.status !== 'generating' || !creative.generatorJobId) {
      return Response.json({ status: creative.status, creative })
    }

    const generator = getVideoGenerator()
    const result = await generator.pollJobStatus(creative.generatorJobId)

    if (result.status === 'complete' && result.fileUrl) {
      const response = await fetch(result.fileUrl)
      const buffer = Buffer.from(await response.arrayBuffer())
      const filePath = `creatives/${creative.id}/original.mp4`
      await storage.save(filePath, buffer)

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
  } catch (err) {
    return Response.json({ error: 'Failed to get status', details: String(err) }, { status: 500 })
  }
}
