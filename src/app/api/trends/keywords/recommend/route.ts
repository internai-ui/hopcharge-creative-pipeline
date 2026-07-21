import { anthropic } from '@/lib/anthropic'
import { extractJsonObject } from '@/lib/json'
import { LENSES, getTrendKeywordGroups, type Lens } from '@/lib/trend-keywords'

// POST → AI-suggested trend keywords per lens (new terms only, excluding what's
// already tracked). Uses Claude (matching the idea generator's model) to brainstorm
// real, India-searchable Google Trends terms mapped to Hopcharge's ad angles. This is
// a brainstorming aid, not a live-volume signal - the (flaky) Google Trends scores
// still decide what's actually hot, and Meta CPL drives real decisions.
export async function POST() {
  try {
    const existing = await getTrendKeywordGroups()
    const lensBlock = LENSES.map(
      (l) => `- ${l.key} (${l.label}): ${l.description}\n  already tracked: ${existing[l.key].join(', ') || '(none)'}`,
    ).join('\n')

    const prompt =
      `You maintain a Google Trends keyword list for Hopcharge, an on-demand / doorstep EV charging ` +
      `service in India (a van brings the charger to the customer). Suggest fresh, real, India-searchable ` +
      `Google Trends search terms for each lens, to track market/cultural interest that maps to ad angles.\n\n` +
      `Lenses:\n${lensBlock}\n\n` +
      `Return 3-5 NEW terms per lens (do NOT repeat anything already tracked). Keep them short, real, and ` +
      `searchable in India. Respond with ONLY strict JSON, no prose:\n` +
      `{"demand": ["..."], "charging": ["..."], "lifestyle": ["..."], "format": ["..."]}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content.find((c) => c.type === 'text')
    if (!text || text.type !== 'text') return Response.json({ error: 'No suggestions returned' }, { status: 502 })

    const raw = extractJsonObject<Record<string, unknown>>(text.text)

    // Keep only new, non-duplicate terms per lens (case-insensitive vs. existing).
    const suggestions = Object.fromEntries(LENSES.map((l) => [l.key, [] as string[]])) as Record<Lens, string[]>
    for (const lens of LENSES) {
      const have = new Set(existing[lens.key].map((t) => t.toLowerCase()))
      const arr = Array.isArray(raw[lens.key]) ? (raw[lens.key] as unknown[]) : []
      for (const t of arr) {
        const term = typeof t === 'string' ? t.trim() : ''
        if (term && term.length <= 80 && !have.has(term.toLowerCase())) {
          have.add(term.toLowerCase())
          suggestions[lens.key].push(term)
        }
      }
      suggestions[lens.key] = suggestions[lens.key].slice(0, 5)
    }

    return Response.json({ suggestions })
  } catch (err) {
    // No Anthropic credits / parse failure / API error - surface it; the UI shows a note.
    return Response.json({ error: 'AI suggestions unavailable', details: String(err).slice(0, 200) }, { status: 502 })
  }
}
