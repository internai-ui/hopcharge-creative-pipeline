import type { WebSearchPlugin } from '../interfaces'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

// Free, keyed web search via the Brave Search API (generous free tier), with the top
// results enriched by Mozilla Readability so the synthesis step (Claude) gets clean
// article text instead of a one-line snippet. Replaces the paid Claude web_search tool
// as the search source; Claude still does the synthesis (WEB_SEARCH=brave is independent
// of the synthesis model).
//
// Env: BRAVE_API_KEY (required), BRAVE_COUNTRY (default IN), BRAVE_RESULT_COUNT (5),
// BRAVE_PARSE_RESULTS (top N to fetch+parse, default 3, 0 disables), BRAVE_FETCH_TIMEOUT_MS.

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

// Fetch a URL and extract its main article text via Readability. Best-effort: returns
// null on any failure (non-HTML, timeout, unparseable) so the caller keeps the snippet.
async function extractArticle(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HopchargeBot/1.0; +https://hopcharge.com)' },
    })
    if (!res.ok) return null
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null
    const html = await res.text()
    const { document } = parseHTML(html)
    const article = new Readability(document as unknown as Document).parse()
    const text = (article?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return text.length > 120 ? text : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export class BraveWebSearch implements WebSearchPlugin {
  name = 'brave'

  private key = process.env.BRAVE_API_KEY
  private country = process.env.BRAVE_COUNTRY ?? 'IN'
  private count = Math.max(1, Math.min(20, Number(process.env.BRAVE_RESULT_COUNT ?? 5)))
  private parseCount = Math.max(0, Number(process.env.BRAVE_PARSE_RESULTS ?? 3))
  private timeoutMs = Math.max(1000, Number(process.env.BRAVE_FETCH_TIMEOUT_MS ?? 6000))
  private maxChars = Math.max(200, Number(process.env.BRAVE_MAX_ARTICLE_CHARS ?? 1500))

  async search(query: string): Promise<Array<{ title: string; snippet: string; url: string }>> {
    if (!this.key) throw new Error('BRAVE_API_KEY is not set (required for WEB_SEARCH=brave)')

    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(this.count))
    url.searchParams.set('country', this.country)

    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': this.key, Accept: 'application/json' },
    })
    if (!res.ok) {
      throw new Error(`Brave search failed for "${query}": ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
    }
    const data = await res.json()
    const web = (data?.web?.results ?? []) as Array<{ title?: string; url?: string; description?: string }>
    const results = web
      .map((r) => ({ title: stripTags(r.title ?? ''), url: r.url ?? '', snippet: stripTags(r.description ?? '') }))
      .filter((r) => r.url)

    // Enrich the top N with full article text (bounded + concurrent + best-effort).
    if (this.parseCount > 0) {
      await Promise.all(
        results.slice(0, this.parseCount).map(async (r) => {
          const text = await extractArticle(r.url, this.timeoutMs)
          if (text) r.snippet = text.slice(0, this.maxChars)
        }),
      )
    }
    return results
  }
}
