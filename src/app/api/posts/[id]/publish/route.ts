import { prisma } from '@/lib/db'
import { getMetaPublisher } from '@/lib/plugins/registry'
import { logPipelineIssue } from '@/lib/pipeline-issues'
import { NextRequest } from 'next/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      include: { creative: { include: { idea: true } } },
    })
    if (!post) return Response.json({ error: 'Post not found' }, { status: 404 })
    if (post.status === 'posted') return Response.json({ error: 'Post already published' }, { status: 400 })

    const publisher = getMetaPublisher()
    const adSchedule = post.adSchedule as { days: number[]; startHour: number; endHour: number } | null
    const idea = post.creative.idea
    const { externalPostId, isDraft } = await publisher.publish({
      creative: post.creative,
      caption: idea.primaryText ?? undefined,
      headline: idea.headline ?? undefined,
      funnelStage: idea.funnelStage ?? undefined,
      scheduledAt: post.scheduledAt ?? undefined,
      adSchedule: adSchedule ?? undefined,
    })

    const existingMeta = (post.platformMetadata as Record<string, unknown> | null) ?? {}
    const updated = await prisma.post.update({
      where: { id },
      data: {
        status: 'posted',
        postedAt: new Date(),
        externalPostId,
        // Draft mode saves a PAUSED ad on Meta; flag it so the queue can label it.
        platformMetadata: { ...existingMeta, draft: isDraft ?? false },
      },
    })

    await prisma.creative.update({
      where: { id: post.creativeId },
      data: { status: 'published' },
    })

    await prisma.agentAction.create({
      data: {
        actionType: 'post_published',
        decisionRationale: `Post ${id} published to ${post.platform} via ${publisher.name}. External ID: ${externalPostId}`,
        relatedEntityId: id,
      },
    })

    return Response.json(updated)
  } catch (err) {
    console.error(`[publish] post ${id} failed:`, err)
    await prisma.post.update({ where: { id }, data: { status: 'failed' } }).catch(() => {})
    await logPipelineIssue({
      severity: 'critical',
      stage: 'publishing',
      description: `Post ${id} failed to publish: ${String(err).slice(0, 300)}`,
      relatedEntityId: id,
    })
    return Response.json({ error: 'Failed to publish post', details: String(err) }, { status: 500 })
  }
}
