import { prisma } from '@/lib/db'
import { getMetaPublisher } from '@/lib/plugins/registry'
import { NextRequest } from 'next/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      include: { creative: true },
    })
    if (!post) return Response.json({ error: 'Post not found' }, { status: 404 })
    if (post.status === 'posted') return Response.json({ error: 'Post already published' }, { status: 400 })

    const publisher = getMetaPublisher()
    const { externalPostId } = await publisher.publish({
      creative: post.creative,
      scheduledAt: post.scheduledAt ?? undefined,
    })

    const updated = await prisma.post.update({
      where: { id },
      data: {
        status: 'posted',
        postedAt: new Date(),
        externalPostId,
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
    await prisma.post.update({ where: { id }, data: { status: 'failed' } }).catch(() => {})
    return Response.json({ error: 'Failed to publish post', details: String(err) }, { status: 500 })
  }
}
