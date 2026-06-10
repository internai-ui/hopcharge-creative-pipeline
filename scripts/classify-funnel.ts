/**
 * One-off / re-runnable: classify each Idea into a marketing funnel stage
 * (TOF / MOF / BOF) using Claude, and persist the result to Idea.funnelStage.
 *
 * By default only classifies ideas that don't yet have a funnelStage set, so
 * it's safe to re-run. Pass `--all` to re-classify every idea.
 *
 * Run: npm run classify-funnel        (or: npm run classify-funnel -- --all)
 */

import path from 'node:path'
import { config } from 'dotenv'
config({ path: path.join(__dirname, '..', '.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import Anthropic from '@anthropic-ai/sdk'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const VALID = ['TOF', 'MOF', 'BOF'] as const
type Stage = (typeof VALID)[number]

async function main() {
  const reclassifyAll = process.argv.includes('--all')

  const ideas = await prisma.idea.findMany({
    where: reclassifyAll ? {} : { funnelStage: null },
    orderBy: { rank: 'asc' },
    select: { id: true, rank: true, title: true, hook: true, cta: true, angle: true },
  })

  if (ideas.length === 0) {
    console.log('No ideas to classify. (Use --all to re-classify everything.)')
    return
  }

  console.log(`Classifying ${ideas.length} idea(s) with Claude...\n`)

  const prompt = `You are a performance-marketing strategist for Hopcharge, an on-demand EV charging subscription service in India (NCR). Classify each ad idea below into ONE marketing funnel stage.

Definitions:
- TOF (Top of Funnel — Awareness): Broad reach, problem-aware or emotional/educational/lifestyle content for people who may not know Hopcharge or even be EV owners yet. No hard sell. Goal: attention & awareness. Signals: storytelling, "did you know", myths, trends, lifestyle, sustainability, broad EV education.
- MOF (Middle of Funnel — Consideration): For people weighing whether Hopcharge is right for them. Benefits, cost comparisons, how-it-works, social proof, testimonials, addressing objections. Goal: nurture & build trust. Signals: "₹X/km math", comparisons, "here's how", proof, partnerships, feature explainers.
- BOF (Bottom of Funnel — Conversion): For people ready to act. Direct response, pricing, plans, offers, urgency, strong booking CTA. Goal: convert now. Signals: "book now", "see plans", pricing mentioned, "subscribe", "included with your plan".

Use the hook and CTA as the strongest signals.

Ideas (JSON):
${JSON.stringify(ideas.map((i) => ({ id: i.id, title: i.title, hook: i.hook, cta: i.cta, angle: i.angle })), null, 2)}

Return ONLY a JSON array, no other text, in this exact shape:
[{"id": "<idea id>", "funnelStage": "TOF" | "MOF" | "BOF", "rationale": "one short sentence"}]`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error(`Claude did not return a JSON array. Got:\n${text}`)

  const results = JSON.parse(match[0]) as Array<{ id: string; funnelStage: string; rationale: string }>
  const byRank = new Map(ideas.map((i) => [i.id, i]))

  let updated = 0
  for (const r of results) {
    const stage = r.funnelStage as Stage
    if (!VALID.includes(stage)) {
      console.warn(`  ! Skipping ${r.id}: invalid stage "${r.funnelStage}"`)
      continue
    }
    const idea = byRank.get(r.id)
    if (!idea) {
      console.warn(`  ! Skipping unknown id ${r.id}`)
      continue
    }
    await prisma.idea.update({ where: { id: r.id }, data: { funnelStage: stage } })
    updated++
    console.log(`  #${idea.rank}  ${stage}  ${idea.title}`)
    console.log(`        ↳ ${r.rationale}`)
  }

  console.log(`\nDone. Updated ${updated} idea(s).`)
}

main()
  .catch((err) => {
    console.error('Classification failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
