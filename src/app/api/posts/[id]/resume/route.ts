import { prisma } from '@/lib/db'
import { getPublisher } from '@/lib/plugins/registry'
import { logPipelineIssue } from '@/lib/pipeline-issues'
import { NextRequest } from 'next/server'

// Reverse of the pause route: re-activate a paused post on its platform. Meta -> the
// ad is set ACTIVE (resumes delivery); YouTube -> the video is flipped back to public.
// Clears the local paused flag so the Publish queue drops the "Paused" badge.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const post = await prisma.post.findUnique({ where: { id } })
    if (!post) return Response.json({ error: 'Post not found' }, { status: 404 })
    if (post.status !== 'posted' || !post.externalPostId) {
      return Response.json({ error: 'Only a published post can be resumed' }, { status: 400 })
    }

    await getPublisher(post.platform).resume(post.externalPostId)

    const existingMeta = (post.platformMetadata as Record<string, unknown> | null) ?? {}
    const updated = await prisma.post.update({
      where: { id },
      data: { platformMetadata: { ...existingMeta, paused: false } },
    })

    await prisma.agentAction.create({
      data: {
        actionType: 'post_resumed',
        decisionRationale: `Post ${id} resumed on ${post.platform} (external id ${post.externalPostId}).`,
        relatedEntityId: id,
      },
    })

    return Response.json(updated)
  } catch (err) {
    console.error(`[resume] post ${id} failed:`, err)
    await logPipelineIssue({
      severity: 'warning',
      stage: 'publishing',
      description: `Post ${id} failed to resume: ${String(err).slice(0, 300)}`,
      relatedEntityId: id,
    })
    return Response.json({ error: 'Failed to resume post', details: String(err) }, { status: 500 })
  }
}
