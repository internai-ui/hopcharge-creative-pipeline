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
    // Real ads/videos imported from both platforms (read-only): Meta paid ads sorted
    // by CPL, YouTube organic uploads have no CPL (null) so they sort after. Shown as
    // thumbnail rows on the Publish page - see PublishClient's "Imported ads" section.
    prisma.historicalAd.findMany({
      orderBy: [{ cpl: 'asc' }, { views: 'desc' }],
      select: {
        id: true, metaAdId: true, platform: true, adName: true, campaignName: true,
        cpl: true, leads: true, isSuccessful: true, creativeImagePath: true, creativeType: true,
        views: true, likesCount: true, commentsCount: true, externalWatchUrl: true,
      },
    }),
  ])

  return (
    <PublishClient
      approvedCreatives={approvedCreatives}
      initialPosts={posts}
      initialImportedAds={importedAds}
      metaAdAccountId={(process.env.META_AD_ACCOUNT_ID ?? '').replace('act_', '') || null}
    />
  )
}
