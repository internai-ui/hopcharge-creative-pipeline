import { prisma } from '@/lib/db'

export async function GET() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = prisma as any
    const [total, successful, lastImport] = await Promise.all([
      db.historicalAd.count(),
      db.historicalAd.count({ where: { isSuccessful: true } }),
      db.historicalAd.findFirst({
        orderBy: { importedAt: 'desc' },
        select: { importedAt: true, source: true },
      }),
    ])
    return Response.json({ total, successful, lastImportedAt: lastImport?.importedAt ?? null })
  } catch {
    return Response.json({ total: 0, successful: 0, lastImportedAt: null })
  }
}
