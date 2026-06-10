import type { Idea, TrendContext, Creative, PerformanceSnapshot } from '@prisma/client'

export type { Idea, TrendContext, Creative, PerformanceSnapshot }

export interface AdConcepts {
  hook: string
  angle: string
  keyMessages: string[]
  tone: string
  ctaStyle: string
}

export interface PerformanceContext {
  topPerformers: Array<{
    idea: Idea
    roas: number
    ctr: number
    fatigueRate: 'slow' | 'fast' | 'none'
    patterns: string[]
  }>
  poorPerformers: Array<{
    idea: Idea
    roas: number
    failureHypothesis: string
  }>
  fastFatiguers: Array<{
    idea: Idea
    daysToFatigue: number
  }>
  winningPatterns: string[]
  patternsToAvoid: string[]
  historicalBaseline: Array<{
    adName: string
    bodyText: string
    cpl: number
    concepts: AdConcepts | null
  }>
}

export interface IdeaSuggestion {
  title: string
  hook: string
  imageVisual: string
  videoVisual: string
  cta: string
  angle: string
  trendTags: string[]
  rationale?: string
}

export type FunnelMode = 'mix' | 'tof' | 'mof' | 'bof'

export interface IdeaGeneratorPlugin {
  name: string
  generateIdeas(params: {
    count: number
    nudge?: string
    existingIdeas?: Idea[]
    performanceContext: PerformanceContext
    trendContext?: TrendContext
    funnelMode?: FunnelMode
  }): Promise<IdeaSuggestion[]>
}

export interface VideoGeneratorPlugin {
  name: string
  submitJob(params: {
    idea: Idea
    referenceAssets?: string[]
  }): Promise<{ jobId: string }>
  pollJobStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed'
    fileUrl?: string
    error?: string
  }>
  cancelJob?(jobId: string): Promise<void>
}

export interface ImageGeneratorPlugin {
  name: string
  generate(params: {
    prompt: string
    referenceAssets?: string[]
  }): Promise<{ fileUrl: string; fileUrls?: string[] }>
}

export interface PublisherPlugin {
  name: string
  platform: 'meta' | 'youtube'
  publish(params: {
    creative: Creative
    caption?: string
    scheduledAt?: Date
    targetingOptions?: Record<string, unknown>
  }): Promise<{ externalPostId: string }>
  pause(externalPostId: string): Promise<void>
  scale(externalPostId: string, budgetMultiplier: number): Promise<void>
}

export interface AnalyticsPlugin {
  name: string
  fetchPerformance(params: {
    externalPostId: string
    dateRange: { from: Date; to: Date }
  }): Promise<Omit<PerformanceSnapshot, 'id' | 'createdAt' | 'postId'>>
}

export interface TrendDataPlugin {
  name: string
  fetchTrends(params: {
    topics: string[]
    region?: string
  }): Promise<{
    scores: Record<string, number>
    risingTopics: string[]
    decliningTopics: string[]
  }>
}

export interface WebSearchPlugin {
  name: string
  search(query: string): Promise<Array<{
    title: string
    snippet: string
    url: string
  }>>
}

export interface AdLibraryPlugin {
  name: string
  fetchCompetitorAds(params: {
    keywords: string[]
    country?: string
    limit?: number
  }): Promise<{
    summary: string
    ads: Array<{ title: string; description: string; format: string }>
  }>
}
