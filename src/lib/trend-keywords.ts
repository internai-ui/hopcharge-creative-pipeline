import { prisma } from '@/lib/db'
import { TOPIC_GROUPS } from '@/lib/trend-topics'

// Server-side accessor for the user-editable Google Trends keyword taxonomy.
// The DB (TrendKeyword) is the source of truth once seeded; the hardcoded lists in
// trend-topics.ts are only the initial seed + the default the UI can reset to.
// (trend-topics.ts stays dependency-free so client components can import it; this
// module is server-only because it imports prisma.)

export type Lens = 'demand' | 'charging' | 'lifestyle' | 'format'

export const LENSES: { key: Lens; label: string; description: string }[] = [
  { key: 'demand', label: 'Demand', description: 'Interest in EVs and the cars Hopcharge customers own' },
  { key: 'charging', label: 'Charging', description: 'The problem Hopcharge solves: access, cost, time, range' },
  { key: 'lifestyle', label: 'Lifestyle / purchase', description: 'Cost-of-ownership and buying-intent angles to piggyback on' },
  { key: 'format', label: 'Content format', description: 'What content forms audiences consume (a search-interest proxy, not ad performance)' },
]

const LENS_KEYS = LENSES.map((l) => l.key)

// The hardcoded taxonomy, used to seed the table on first use and as the "reset".
export const DEFAULT_GROUPS: Record<Lens, string[]> = {
  demand: TOPIC_GROUPS.demand,
  charging: TOPIC_GROUPS.charging,
  lifestyle: TOPIC_GROUPS.lifestyle,
  format: TOPIC_GROUPS.format,
}

export function isLens(v: unknown): v is Lens {
  return typeof v === 'string' && (LENS_KEYS as string[]).includes(v)
}

// Seed the table from the defaults the first time it's used. Idempotent: once any
// row exists, this is a no-op, so user edits (including emptying a lens) are kept.
export async function ensureSeeded(): Promise<void> {
  const count = await prisma.trendKeyword.count()
  if (count > 0) return
  const rows = LENSES.flatMap((l) => DEFAULT_GROUPS[l.key].map((term) => ({ lens: l.key, term })))
  await prisma.trendKeyword.createMany({ data: rows, skipDuplicates: true })
}

// Keywords grouped by lens (every lens key present, possibly empty). Seeds on first
// use so the trend job and the UI always agree.
export async function getTrendKeywordGroups(): Promise<Record<Lens, string[]>> {
  await ensureSeeded()
  const rows = await prisma.trendKeyword.findMany({ orderBy: { createdAt: 'asc' } })
  const groups = Object.fromEntries(LENS_KEYS.map((k) => [k, [] as string[]])) as Record<Lens, string[]>
  for (const r of rows) {
    if (isLens(r.lens)) groups[r.lens].push(r.term)
  }
  return groups
}

// Flat list of every keyword across lenses (what the fetcher queries).
export async function getAllKeywords(): Promise<string[]> {
  const groups = await getTrendKeywordGroups()
  return Object.values(groups).flat()
}
