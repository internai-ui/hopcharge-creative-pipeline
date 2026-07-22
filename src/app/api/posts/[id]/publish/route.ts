import { prisma } from '@/lib/db'
import { getPublisher } from '@/lib/plugins/registry'
import { logPipelineIssue } from '@/lib/pipeline-issues'
import { explainError } from '@/lib/error-guidance'
import { NextRequest } from 'next/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Per-publish draft/production toggle from the Publish modal; undefined = use the
  // platform's *_DRAFT_MODE env default.
  const body = await req.json().catch(() => ({}))
  const draft = typeof body?.draft === 'boolean' ? body.draft : undefined
  let platform: string | undefined
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      include: { creative: { include: { idea: true } } },
    })
    if (!post) return Response.json({ error: 'Post not found' }, { status: 404 })
    if (post.status === 'posted') return Response.json({ error: 'Post already published' }, { status: 400 })
    platform = post.platform

    // YouTube accepts video only. Catch an image creative here so the user gets a clear
    // message + next steps (not a 500) - these are dead-ends: delete the post and
    // generate a video for YouTube, or publish the image to Meta instead.
    if (post.platform === 'youtube' && post.creative.mediaType !== 'video') {
      const g = explainError('image creative youtube video creatives only', { platform })
      return Response.json({ error: 'Cannot publish to YouTube', reason: g.reason, actions: g.actions }, { status: 400 })
    }

    const publisher = getPublisher(post.platform)
    const adSchedule = post.adSchedule as { days: number[]; startHour: number; endHour: number } | null
    const idea = post.creative.idea
    const { externalPostId, isDraft } = await publisher.publish({
      creative: post.creative,
      caption: idea.primaryText ?? undefined,
      headline: idea.headline ?? undefined,
      funnelStage: idea.funnelStage ?? undefined,
      scheduledAt: post.scheduledAt ?? undefined,
      adSchedule: adSchedule ?? undefined,
      ytHeadlines: idea.ytHeadlines,
      ytDescriptions: idea.ytDescriptions,
      ytCallToAction: idea.ytCallToAction,
      draft,
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
    const g = explainError(String(err), { platform })
    return Response.json(
      { error: 'Failed to publish post', reason: g.reason, actions: g.actions, details: String(err) },
      { status: 500 },
    )
  }
}
