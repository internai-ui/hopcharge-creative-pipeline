import type { PublisherPlugin } from '../interfaces'
import type { Creative } from '@prisma/client'

export class PublisherStub implements PublisherPlugin {
  name = 'stub'
  platform = 'meta' as const

  async publish({ creative }: { creative: Creative }): Promise<{ externalPostId: string }> {
    await new Promise((r) => setTimeout(r, 200))
    return { externalPostId: `stub-post-${creative.id}-${Date.now()}` }
  }

  async pause(_externalPostId: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 100))
  }

  async scale(_externalPostId: string, _budgetMultiplier: number): Promise<void> {
    await new Promise((r) => setTimeout(r, 100))
  }
}
