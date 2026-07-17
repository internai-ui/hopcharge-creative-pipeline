import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { LENSES, ensureSeeded, isLens, type Lens } from '@/lib/trend-keywords'

// GET → the editable keyword taxonomy grouped by lens, each keyword with its id so
// the Trends page can delete individual terms. Seeds the defaults on first call.
export async function GET() {
  try {
    await ensureSeeded()
    const rows = await prisma.trendKeyword.findMany({ orderBy: { createdAt: 'asc' } })
    const groups = Object.fromEntries(LENSES.map((l) => [l.key, [] as { id: string; term: string }[]])) as Record<
      Lens,
      { id: string; term: string }[]
    >
    for (const r of rows) {
      if (isLens(r.lens)) groups[r.lens].push({ id: r.id, term: r.term })
    }
    return Response.json({ lenses: LENSES, groups })
  } catch (err) {
    return Response.json({ error: 'Failed to load keywords', details: String(err) }, { status: 500 })
  }
}

// POST { lens, term } → add a keyword to a lens (deduped on lens+term).
export async function POST(req: NextRequest) {
  try {
    const { lens, term } = await req.json()
    const clean = typeof term === 'string' ? term.trim() : ''
    if (!isLens(lens)) return Response.json({ error: 'Invalid lens' }, { status: 400 })
    if (!clean) return Response.json({ error: 'Keyword is required' }, { status: 400 })
    if (clean.length > 80) return Response.json({ error: 'Keyword is too long (max 80 chars)' }, { status: 400 })

    // Google Trends caps a request at 5 keywords; the fetcher chunks in 4s (+anchor).
    // No hard cap here, but keep it sane so a lens stays queryable in a few chunks.
    const row = await prisma.trendKeyword.upsert({
      where: { lens_term: { lens, term: clean } },
      create: { lens, term: clean },
      update: {},
    })
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: 'Failed to add keyword', details: String(err) }, { status: 500 })
  }
}

// DELETE { id } → remove one keyword.
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    if (!id || typeof id !== 'string') return Response.json({ error: 'id is required' }, { status: 400 })
    await prisma.trendKeyword.delete({ where: { id } }).catch(() => {})
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: 'Failed to delete keyword', details: String(err) }, { status: 500 })
  }
}
