import type { WebSearchPlugin } from '../interfaces'

export class WebSearchStub implements WebSearchPlugin {
  name = 'stub'

  async search(query: string): Promise<Array<{ title: string; snippet: string; url: string }>> {
    return [
      {
        title: `[Stub] ${query} — Top Result`,
        snippet: `This is a stub search result for "${query}". In production, this would return real web search results from Claude's web_search tool.`,
        url: 'https://example.com/stub-result-1',
      },
      {
        title: `[Stub] ${query} — Trends Report`,
        snippet: `Mock trend report: UGC-style videos continue to outperform cinematic formats on Meta by 2.3x. Talking head content with captions sees 45% higher completion rates.`,
        url: 'https://example.com/stub-result-2',
      },
      {
        title: `[Stub] ${query} — Industry Insights`,
        snippet: `EV adoption is up 34% year-over-year. Charging infrastructure anxiety remains the #1 barrier. Brands that lead with convenience messaging see lower CPM.`,
        url: 'https://example.com/stub-result-3',
      },
    ]
  }
}
