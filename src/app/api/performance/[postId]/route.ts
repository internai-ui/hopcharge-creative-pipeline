import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await params
    const snapshots = await prisma.performanceSnapshot.findMany({
      where: { postId },
      orderBy: { snapshotDate: 'asc' },
    })
    return Response.json(snapshots)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch snapshots', details: String(err) }, { status: 500 })
  }
}
