import type { AnalyticsPlugin, PerformanceSnapshot } from '../interfaces'
import { Decimal } from '@prisma/client/runtime/client'

export class AnalyticsStub implements AnalyticsPlugin {
  name = 'stub'

  async fetchPerformance({ dateRange }: {
    externalPostId: string
    dateRange: { from: Date; to: Date }
  }): Promise<Omit<PerformanceSnapshot, 'id' | 'createdAt' | 'postId'>> {
    const impressions = Math.floor(5000 + Math.random() * 50000)
    const clicks = Math.floor(impressions * (0.01 + Math.random() * 0.04))
    const spend = 50 + Math.random() * 500
    const cpl = 50 + Math.random() * 120 // ₹50–₹170 cost per lead
    const leads = Math.max(1, Math.round(spend / cpl))

    return {
      snapshotDate: dateRange.from,
      impressions,
      reach: Math.floor(impressions * 0.85),
      clicks,
      spend: new Decimal(spend.toFixed(2)),
      cpl: new Decimal(cpl.toFixed(2)),
      leads,
      cpm: new Decimal(((spend / impressions) * 1000).toFixed(4)),
      ctr: new Decimal((clicks / impressions).toFixed(6)),
      frequency: new Decimal((1 + Math.random() * 3).toFixed(4)),
      rawData: { source: 'stub' },
    }
  }
}
