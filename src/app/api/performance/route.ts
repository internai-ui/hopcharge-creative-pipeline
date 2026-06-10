import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  try {
    const where = {
      ...(from || to ? {
        snapshotDate: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        },
      } : {}),
    }

    const snapshots = await prisma.performanceSnapshot.findMany({
      where,
      include: {
        post: {
          include: { creative: { include: { idea: true } } },
        },
      },
      orderBy: { snapshotDate: 'desc' },
    })

    // Aggregate totals
    const totalSpend = snapshots.reduce((s, snap) => s + Number(snap.spend), 0)
    const totalImpressions = snapshots.reduce((s, snap) => s + snap.impressions, 0)
    const totalClicks = snapshots.reduce((s, snap) => s + snap.clicks, 0)
    const avgRoas = snapshots.length > 0
      ? snapshots.reduce((s, snap) => s + Number(snap.roas ?? 0), 0) / snapshots.length
      : 0
    const avgCpm = snapshots.length > 0
      ? snapshots.reduce((s, snap) => s + Number(snap.cpm), 0) / snapshots.length
      : 0
    const avgCtr = snapshots.length > 0
      ? snapshots.reduce((s, snap) => s + Number(snap.ctr), 0) / snapshots.length
      : 0

    return Response.json({
      summary: { totalSpend, totalImpressions, totalClicks, avgRoas, avgCpm, avgCtr },
      snapshots,
    })
  } catch (err) {
    return Response.json({ error: 'Failed to fetch performance', details: String(err) }, { status: 500 })
  }
}
