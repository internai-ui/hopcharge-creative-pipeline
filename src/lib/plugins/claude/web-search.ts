import type Anthropic from '@anthropic-ai/sdk'
import { anthropic as client } from '@/lib/anthropic'
import { extractJsonArray } from '@/lib/json'
import type { WebSearchPlugin } from '../interfaces'

export class ClaudeWebSearch implements WebSearchPlugin {
  name = 'claude'

  async search(query: string): Promise<Array<{ title: string; snippet: string; url: string }>> {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }] as unknown as Anthropic.Messages.Tool[],
      messages: [
        {
          role: 'user',
          content: `Search for: ${query}\n\nReturn the top 5 most relevant results as a JSON array:\n[{"title": "...", "snippet": "...", "url": "..."}]\nOnly return the JSON array, no other text.`,
        },
      ],
    })

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') return []

    return extractJsonArray<Array<{ title: string; snippet: string; url: string }>>(textContent.text) ?? []
  }
}
