/**
 * Helpers for pulling JSON out of LLM responses, which often wrap the JSON in
 * prose or markdown fences. We grab the first balanced-looking object/array and
 * parse it.
 */

/** Extract and parse the first JSON object (`{...}`) found in `text`. Throws if none. */
export function extractJsonObject<T = unknown>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in model response')
  return JSON.parse(match[0]) as T
}

/** Extract and parse the first JSON array (`[...]`) found in `text`. Returns `null` if none. */
export function extractJsonArray<T = unknown>(text: string): T | null {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return null
  return JSON.parse(match[0]) as T
}
