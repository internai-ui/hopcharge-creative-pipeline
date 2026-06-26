import { prisma } from '@/lib/db'
import { PublishClient } from '@/components/publish/PublishClient'

export default async function PublishPage() {
  const [approvedCreatives, posts, importedAds] = await Promise.all([
    prisma.creative.findMany({
      where: { status: 'approved' },
      include: { idea: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.post.findMany({
      include: { creative: { include: { idea: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    // Real ads imported from the Meta account (read-only).
    prisma.historicalAd.findMany({
      orderBy: { cpl: 'asc' },
      select: { id: true, metaAdId: true, adName: true, campaignName: true, cpl: true, leads: true, isSuccessful: true },
    }),
  ])

  return <PublishClient approvedCreatives={approvedCreatives} initialPosts={posts} initialImportedAds={importedAds} />
}
