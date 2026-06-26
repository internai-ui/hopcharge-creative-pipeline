/**
 * One-off / re-runnable backfill:
 *  1. Generate Meta ad copy (primaryText + headline) for every Idea that's
 *     missing it, derived deterministically from existing fields - no AI call
 *     (the Anthropic key has no credits, and this keeps it free + reproducible).
 *  2. Reset every Idea to the first pipeline stage (status = "pending"), i.e.
 *     not yet selected or pushed into generation.
 *
 * By default only fills copy where it's missing. Pass `--all` to regenerate copy
 * for every idea. The status reset always runs.
 *
 * Run: npm run backfill-ad-copy        (or: npx tsx scripts/backfill-ad-copy.ts --all)
 */

import path from 'node:path'
import { config } from 'dotenv'
config({ path: path.join(__dirname, '..', '.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const HEADLINE_MAX = 40

// Headline: the idea title is already a short memorable name - perfect for the
// bold line. Cap at ~40 chars on a word boundary.
function deriveHeadline(title: string): string {
  const t = title.trim()
  if (t.length <= HEADLINE_MAX) return t
  const clipped = t.slice(0, HEADLINE_MAX)
  const lastSpace = clipped.lastIndexOf(' ')
  return (lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped).trim()
}

// Primary text: lead with the hook, then nudge toward a WhatsApp chat (every ad
// uses the "Send WhatsApp Message" CTA). Avoid doubling up if the hook already
// mentions WhatsApp/messaging.
function derivePrimaryText(hook: string): string {
  const base = hook.trim().replace(/\s+/g, ' ')
  const mentionsChat = /whatsapp|message us|msg us|dm us|chat/i.test(base)
  if (mentionsChat) return base
  const sep = /[.!?]$/.test(base) ? '' : '.'
  return `${base}${sep} WhatsApp us to book your charge.`
}

async function main() {
  const regenAll = process.argv.includes('--all')

  const ideas = await prisma.idea.findMany({
    orderBy: { rank: 'asc' },
    select: { id: true, title: true, hook: true, primaryText: true, headline: true },
  })

  let copyUpdated = 0
  for (const idea of ideas) {
    const needsCopy = regenAll || !idea.primaryText || !idea.headline
    if (!needsCopy) continue
    await prisma.idea.update({
      where: { id: idea.id },
      data: {
        primaryText: regenAll || !idea.primaryText ? derivePrimaryText(idea.hook) : idea.primaryText,
        headline: regenAll || !idea.headline ? deriveHeadline(idea.title) : idea.headline,
      },
    })
    copyUpdated++
  }

  // Reset every idea to the first pipeline stage.
  const reset = await prisma.idea.updateMany({
    where: { status: { not: 'pending' } },
    data: { status: 'pending' },
  })

  console.log(`Backfilled ad copy on ${copyUpdated}/${ideas.length} idea(s).`)
  console.log(`Reset ${reset.count} idea(s) to status "pending" (first stage).`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
