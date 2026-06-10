import Anthropic from '@anthropic-ai/sdk'

// Shared Anthropic client. Import this instead of constructing a new client per
// module so the API key and any future config live in one place.
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
