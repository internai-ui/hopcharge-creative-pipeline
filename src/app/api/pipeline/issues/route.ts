import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const severity = searchParams.get('severity')
  const resolved = searchParams.get('resolved')

  try {
    const issues = await prisma.pipelineIssue.findMany({
      where: {
        ...(severity ? { severity: severity as never } : {}),
        ...(resolved !== null ? { isResolved: resolved === 'true' } : {}),
      },
      orderBy: [
        { isResolved: 'asc' },
        { severity: 'asc' },
        { createdAt: 'desc' },
      ],
    })
    return Response.json(issues)
  } catch (err) {
    return Response.json({ error: 'Failed to fetch issues', details: String(err) }, { status: 500 })
  }
}
