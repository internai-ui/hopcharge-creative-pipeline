import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const platform = searchParams.get('platform')

  try {
    const posts = await prisma.post.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(platform ? { platform: platform as never } : {}),
      },
      include: { creative: { include: { idea: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return Response.json(posts)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch posts', details: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { creativeId, platforms, scheduledAt, adSchedule } = await req.json() as {
      creativeId: string
      platforms: string[]
      scheduledAt?: string
      adSchedule?: { days: number[]; startHour: number; endHour: number }
    }

    const creative = await prisma.creative.findUnique({ where: { id: creativeId } })
    if (!creative) return Response.json({ error: 'Creative not found' }, { status: 404 })
    if (creative.status !== 'approved') {
      return Response.json({ error: 'Creative must be approved before posting' }, { status: 400 })
    }

    const posts = await Promise.all(
      platforms.map((platform) =>
        prisma.post.create({
          data: {
            creativeId,
            platform: platform as never,
            status: 'queued',
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            adSchedule: adSchedule ?? undefined,
          },
        })
      )
    )

    return Response.json(posts, { status: 201 })
  } catch (err) {
    return Response.json({ error: 'Failed to create post', details: String(err) }, { status: 500 })
  }
}
