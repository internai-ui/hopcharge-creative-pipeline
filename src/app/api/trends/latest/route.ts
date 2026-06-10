import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const latest = await prisma.trendContext.findFirst({
      orderBy: { createdAt: 'desc' },
    })
    if (!latest) return Response.json({ error: 'No trend context found' }, { status: 404 })
    return Response.json(latest)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch trend context', details: String(err) }, { status: 500 })
  }
}
