import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function PATCH(req: NextRequest) {
  try {
    const { orderedIds } = await req.json() as { orderedIds: string[] }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.idea.update({ where: { id }, data: { rank: index + 1 } })
      )
    )

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: 'Failed to reorder ideas', details: String(err) }, { status: 500 })
  }
}
