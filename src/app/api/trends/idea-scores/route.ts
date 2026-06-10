import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const ideas = await prisma.idea.findMany({
      where: { status: { in: ['pending', 'selected'] } },
      orderBy: [{ trendScore: 'asc' }],
      select: {
        id: true,
        title: true,
        trendTags: true,
        trendScore: true,
        trendWarning: true,
        trendScoredAt: true,
        status: true,
      },
    })
    return Response.json(ideas)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch idea scores', details: String(err) }, { status: 500 })
  }
}
