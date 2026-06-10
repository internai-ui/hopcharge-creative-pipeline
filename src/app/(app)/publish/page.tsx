import { prisma } from '@/lib/db'
import { PublishClient } from '@/components/publish/PublishClient'

export default async function PublishPage() {
  const [approvedCreatives, posts] = await Promise.all([
    prisma.creative.findMany({
      where: { status: 'approved' },
      include: { idea: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.post.findMany({
      include: { creative: { include: { idea: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return <PublishClient approvedCreatives={approvedCreatives} initialPosts={posts} />
}
