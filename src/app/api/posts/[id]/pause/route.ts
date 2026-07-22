import { prisma } from '@/lib/db'
import { getPublisher } from '@/lib/plugins/registry'
import { logPipelineIssue } from '@/lib/pipeline-issues'
import { NextRequest } from 'next/server'

// Pause / unpublish a LIVE post on its platform. Meta -> the ad is set PAUSED (stops
// delivery); YouTube -> the video is flipped to private (taken down). The local post
// stays "posted" (it still exists upstream) but is flagged paused so the Publish
// queue can label it and offer nothing further until it's managed natively.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const post = await prisma.post.findUnique({ where: { id } })
    if (!post) return Response.json({ error: 'Post not found' }, { status: 404 })
    if (post.status !== 'posted' || !post.externalPostId) {
      return Response.json({ error: 'Only a published post can be paused' }, { status: 400 })
    }

    await getPublisher(post.platform).pause(post.externalPostId)

    const existingMeta = (post.platformMetadata as Record<string, unknown> | null) ?? {}
    const updated = await prisma.post.update({
      where: { id },
      data: { platformMetadata: { ...existingMeta, paused: true } },
    })

    await prisma.agentAction.create({
      data: {
        actionType: 'post_paused',
        decisionRationale: `Post ${id} paused on ${post.platform} (external id ${post.externalPostId}).`,
        relatedEntityId: id,
      },
    })

    return Response.json(updated)
  } catch (err) {
    console.error(`[pause] post ${id} failed:`, err)
    await logPipelineIssue({
      severity: 'warning',
      stage: 'publishing',
      description: `Post ${id} failed to pause: ${String(err).slice(0, 300)}`,
      relatedEntityId: id,
    })
    return Response.json({ error: 'Failed to pause post', details: String(err) }, { status: 500 })
  }
}
