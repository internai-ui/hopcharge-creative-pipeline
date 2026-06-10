import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  try {
    const creatives = await prisma.creative.findMany({
      where: status ? { status: status as never } : undefined,
      include: { idea: true },
      orderBy: { createdAt: 'desc' },
    })
    return Response.json(creatives)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch creatives', details: String(err) }, { status: 500 })
  }
}
