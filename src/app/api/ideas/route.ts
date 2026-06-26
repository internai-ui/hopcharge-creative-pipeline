import { prisma } from '@/lib/db'
import { deriveFirstFrameVisual } from '@/lib/plugins/prompt-constants'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const trendHealth = searchParams.get('trendHealth')
  const funnelStage = searchParams.get('funnelStage')
  const sortBy = searchParams.get('sortBy') ?? 'rank'

  try {
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (funnelStage) where.funnelStage = funnelStage
    if (trendHealth === 'on-trend') where.trendScore = { gte: 0.6 }
    else if (trendHealth === 'warning') where.trendScore = { gte: 0.3, lt: 0.6 }
    else if (trendHealth === 'stale') where.trendScore = { lt: 0.3 }

    const orderBy: Record<string, string>[] = []
    if (sortBy === 'rank') orderBy.push({ rank: 'asc' })
    else if (sortBy === 'performance') orderBy.push({ performanceScore: 'asc' }) // lower CPL = better
    else if (sortBy === 'trendScore') orderBy.push({ trendScore: 'desc' })
    else if (sortBy === 'created') orderBy.push({ createdAt: 'desc' })

    const ideas = await prisma.idea.findMany({ where, orderBy })
    return Response.json(ideas)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch ideas', details: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const count = await prisma.idea.count()
    const idea = await prisma.idea.create({
      data: {
        title: body.title,
        hook: body.hook,
        imageVisual: body.imageVisual,
        videoVisual: body.videoVisual,
        videoFirstFrame: body.videoFirstFrame?.trim() || deriveFirstFrameVisual(body.videoVisual ?? ''),
        cta: body.cta,
        // Required - the manual drawer enforces these; fall back defensively.
        primaryText: body.primaryText?.trim() || body.hook,
        headline: body.headline?.trim() || body.title,
        angle: body.angle ?? 'pain_point',
        funnelStage: body.funnelStage ?? null,
        nudge: body.nudge,
        sourceType: 'human_added',
        status: 'pending',
        rank: count + 1,
        trendTags: body.trendTags ?? [],
      },
    })
    return Response.json(idea, { status: 201 })
  } catch (err) {
    return Response.json({ error: 'Failed to create idea', details: String(err) }, { status: 500 })
  }
}
