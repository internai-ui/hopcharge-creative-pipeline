// ── YouTube "success" metric (organic - no spend/CPL exists) ────────────────────
//
// Meta ads are judged on cost-per-lead (CPL_SUCCESS_THRESHOLD in meta-historical.ts) -
// a paid-delivery concept that simply doesn't exist for an organic YouTube upload
// (no ad account, no spend, no leads). Ranking YouTube posts by CPL - as the pipeline
// used to do - gives every YouTube post an undefined/Infinity CPL, which silently
// sorts them all in as "worst performers" regardless of how the content actually did.
//
// The organic equivalent of "did this convert efficiently" is "did this resonate":
// engagement rate = (likes + comments) / views. It's the standard organic-video
// health metric (Hootsuite/Social Blade et al. commonly cite ~1-3% as typical,
// 3-6% as good, 6%+ as excellent for YouTube) and is built entirely from numbers
// this app already pulls via the Data API (views/likeCount/commentCount - see
// youtube/analytics.ts and youtube-historical.ts). Watch time / audience retention
// would be a richer signal but needs the separate YouTube Analytics API
// (yt-analytics.readonly scope), which isn't wired up here.
//
// Both knobs are env-overridable, mirroring CPL_SUCCESS_THRESHOLD's pattern.

// Default 4% - solidly in the "good" band per the industry benchmarks above,
// without demanding "excellent" (6%+), which would flag most honest content as
// underperforming.
export const YT_ENGAGEMENT_SUCCESS_THRESHOLD_PCT = Number(process.env.YT_ENGAGEMENT_SUCCESS_THRESHOLD_PCT ?? 4)

// Below this many views, a like/comment count is too noisy to classify - one like
// on 5 views is a meaningless 20% "engagement rate". Mirrors how a Meta ad needs
// real lead data before it's judged at all.
export const YT_MIN_VIEWS_FOR_CLASSIFICATION = Number(process.env.YT_MIN_VIEWS_FOR_CLASSIFICATION ?? 100)

/** (likes + comments) / views, as a percentage. 0 when there are no views. */
export function youtubeEngagementRate(views: number, likes: number, comments: number): number {
  if (views <= 0) return 0
  return ((likes + comments) / views) * 100
}

/**
 * true = beat the engagement-rate threshold, false = didn't, null = not enough
 * views yet to classify either way (too new / too little reach for the rate to
 * mean anything).
 */
export function classifyYoutubeSuccess(views: number, likes: number, comments: number): boolean | null {
  if (views < YT_MIN_VIEWS_FOR_CLASSIFICATION) return null
  return youtubeEngagementRate(views, likes, comments) >= YT_ENGAGEMENT_SUCCESS_THRESHOLD_PCT
}
