import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const issue = await prisma.pipelineIssue.update({
      where: { id },
      data: { isResolved: true, resolvedAt: new Date() },
    })
    return Response.json(issue)
  } catch (err) {
    return Response.json({ error: 'Failed to resolve issue', details: String(err) }, { status: 500 })
  }
}
