import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const post = await prisma.post.findUnique({
      where: { id },
      include: { creative: { include: { idea: true } }, snapshots: { orderBy: { snapshotDate: 'desc' } } },
    })
    if (!post) return Response.json({ error: 'Post not found' }, { status: 404 })
    return Response.json(post)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch post', details: String(err) }, { status: 500 })
  }
}
