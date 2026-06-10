import { prisma } from '@/lib/db'
import { getVideoGenerator } from '@/lib/plugins/registry'
import { NextRequest } from 'next/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const creative = await prisma.creative.findUnique({
      where: { id },
      include: { idea: true },
    })

    if (!creative) return Response.json({ error: 'Creative not found' }, { status: 404 })
    if (creative.status !== 'generating') {
      return Response.json({ error: 'Creative is not currently generating' }, { status: 400 })
    }

    // Tell the generator to cancel the job
    if (creative.generatorJobId) {
      const generator = getVideoGenerator()
      if (generator.cancelJob) {
        await generator.cancelJob(creative.generatorJobId).catch(() => {
          // Non-fatal — generator may not support cancel or job already ended
        })
      }
    }

    // Mark creative as rejected (cancelled)
    await prisma.creative.update({
      where: { id },
      data: { status: 'rejected', metadata: { cancelledAt: new Date().toISOString() } },
    })

    // Revert idea back to selected so the user can try again
    if (creative.idea.status === 'in_production') {
      await prisma.idea.update({
        where: { id: creative.ideaId },
        data: { status: 'selected' },
      })
    }

    await prisma.agentAction.create({
      data: {
        actionType: 'creative_cancelled',
        decisionRationale: `Video generation cancelled for creative ${id} (idea: "${creative.idea.title}")`,
        relatedEntityId: id,
      },
    })

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
