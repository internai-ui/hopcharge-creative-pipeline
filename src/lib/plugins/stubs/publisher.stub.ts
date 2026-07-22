import type { PublisherPlugin } from '../interfaces'
import type { Creative } from '@prisma/client'

// Fake publisher for local/dev use (PUBLISHER_META=stub / PUBLISHER_YOUTUBE=stub).
// Returns a fake external id without touching any real API. Parameterized by
// platform so both Meta and YouTube run in stub mode; YouTube stub posts are
// flagged as drafts so the queue's draft badge is exercised without credentials.
export class PublisherStub implements PublisherPlugin {
  name = 'stub'
  platform: 'meta' | 'youtube'

  constructor(platform: 'meta' | 'youtube' = 'meta') {
    this.platform = platform
  }

  async publish({ creative }: { creative: Creative }): Promise<{ externalPostId: string; isDraft: boolean }> {
    await new Promise((r) => setTimeout(r, 200))
    return {
      externalPostId: `stub-${this.platform}-${creative.id}-${Date.now()}`,
      isDraft: this.platform === 'youtube',
    }
  }

  async pause(_externalPostId: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 100))
  }

  async resume(_externalPostId: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 100))
  }

  async scale(_externalPostId: string, _budgetMultiplier: number): Promise<void> {
    await new Promise((r) => setTimeout(r, 100))
  }
}
