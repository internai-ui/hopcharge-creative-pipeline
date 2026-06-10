import { prisma } from '@/lib/db'
import { anthropic as client } from '@/lib/anthropic'

export async function GET() {
  try {
    const actions = await prisma.agentAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const total = actions.length
    const overridden = actions.filter((a) => a.humanOverridden).length
    const overrideRate = total > 0 ? (overridden / total) * 100 : 0

    // Count outcomes
    const withOutcomes = actions.filter((a) => a.outcome)
    const winningOutcomes = withOutcomes.filter((a) => a.outcome === 'winning_creative').length
    const agentWasRight = withOutcomes.length > 0
      ? ((withOutcomes.length - overridden) / withOutcomes.length) * 100
      : 100

    // Ask Claude for narrative evaluation
    const prompt = `You are evaluating the performance of an autonomous ad creative pipeline agent for Hopcharge (an EV charging company).

Here are the agent's recent decisions:
${actions.slice(0, 20).map((a) =>
  `- [${a.actionType}] ${a.decisionRationale.slice(0, 200)}${a.humanOverridden ? ` [OVERRIDDEN: ${a.humanOverrideReason}]` : ''}`
).join('\n')}

Statistics:
- Total decisions: ${total}
- Human override rate: ${overrideRate.toFixed(1)}%
- Known winning outcomes: ${winningOutcomes}

Write a 3-4 sentence narrative evaluation of the agent's performance. Focus on: what patterns the agent is detecting correctly, where human judgment is overriding it and why that might be, and any recommendations for improving the prompts or logic. Be specific and actionable.`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const narrative = response.content[0].type === 'text' ? response.content[0].text : 'Evaluation unavailable.'

    return Response.json({
      summary: {
        totalDecisions: total,
        humanOverrideRate: overrideRate,
        overriddenCount: overridden,
        winningOutcomes,
        agentWasRight,
      },
      actions,
      narrative,
    })
  } catch (err) {
    return Response.json({ error: 'Evaluation failed', details: String(err) }, { status: 500 })
  }
}
