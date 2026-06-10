import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '20')

  try {
    const [actions, total] = await Promise.all([
      prisma.agentAction.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.agentAction.count(),
    ])

    return Response.json({ actions, total, page, limit, pages: Math.ceil(total / limit) })
  } catch (err) {
    return Response.json({ error: 'Failed to fetch agent actions', details: String(err) }, { status: 500 })
  }
}
