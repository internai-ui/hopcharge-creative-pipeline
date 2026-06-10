import { prisma } from '@/lib/db'
import { ReviewClient } from '@/components/review/ReviewClient'

export default async function ReviewPage() {
  const creatives = await prisma.creative.findMany({
    include: { idea: true },
    orderBy: { createdAt: 'desc' },
  })

  return <ReviewClient initialCreatives={creatives} />
}
