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
    cpl: number
    ctr: number
    fatigueRate: 'slow' | 'fast' | 'none'
    patterns: string[]
  }>
  poorPerformers: Array<{
    idea: Idea
    cpl: number
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
  // Still prompt for the video's opening frame (0-3s hook shot) - rendered as the
  // image2video first frame. Distinct from imageVisual (the finished poster).
  videoFirstFrame?: string
  cta: string
  // Meta ad copy: primaryText is the body above the creative, headline the
  // bold line beneath it. Both are required for a complete ad.
  primaryText: string
  headline: string
  angle: string
  funnelStage?: 'TOF' | 'MOF' | 'BOF'
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
  // Optional async path for slow generators: submit returns immediately with a job
  // id, and a poller fetches the result later. When present, the image route uses
  // this instead of generate() so the HTTP request doesn't block for minutes.
  submitJob?(params: {
    prompt: string
    referenceAssets?: string[]
  }): Promise<{ jobId: string }>
  pollJobStatus?(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed'
    fileUrls?: string[]
    error?: string
  }>
}

export interface AdSchedule {
  days: number[]      // 0 = Sunday … 6 = Saturday
  startHour: number   // 0–23
  endHour: number     // 1–24
}

export interface PublisherPlugin {
  name: string
  platform: 'meta' | 'youtube'
  publish(params: {
    creative: Creative
    caption?: string        // ad primary text (body)
    headline?: string       // ad headline (bold line under the creative)
    funnelStage?: 'TOF' | 'MOF' | 'BOF' | null  // drives optimization goal
    scheduledAt?: Date
    adSchedule?: AdSchedule
    targetingOptions?: Record<string, unknown>
  }): Promise<{ externalPostId: string; isDraft?: boolean }>
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
    // Optional keyword included in every request to make scores comparable across
    // the 5-keyword chunks Google Trends imposes (see GoogleTrendsFetcher).
    anchor?: string
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
