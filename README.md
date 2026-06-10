# Hopcharge Ad Engine

An internal automated marketing pipeline tool for Hopcharge. The system orchestrates the full lifecycle of ad creative: AI-generated idea matrices → video generation → human review → publishing to Meta → performance analytics → feeding winning patterns back into idea generation — continuously and on schedule.

---

## Pages

| Page | URL | What it does |
|---|---|---|
| Ideas | `/ideas` | Ranked, drag-to-reorder idea matrix. Generate AI ideas, inline-edit fields, filter by trend health, select ideas for production. |
| Review | `/review` | Grid of generated creatives. Watch videos, re-upload edited versions, approve or reject. |
| Publish | `/publish` | Queue approved creatives for publishing to Meta (or YouTube). Schedule or post immediately. Retry failed posts. |
| Performance | `/performance` | Analytics dashboard — ROAS over time, spend vs impressions, sortable per-creative table, daily snapshot drill-down. |
| Trends | `/trends` | Live trend intelligence — rising/declining topics, platform format trends, competitor ad insights, idea staleness table, topic score history chart. |
| Evaluation | `/evaluation` | Pipeline health — active issues by severity, agent decision log, human override rate, AI-generated evaluation report. |

---

## Running locally

### Prerequisites
- Node.js 20+
- PostgreSQL 14+ running locally

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in at minimum DATABASE_URL
cp .env.example .env.local

# 3. Push schema to your database
npm run db:push

# 4. Seed with demo data (15 ideas, 30 days of perf snapshots, etc.)
npm run db:seed

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/ideas`.

If `INTERNAL_PASSWORD` is set in `.env.local`, you'll be prompted to log in first.

> All plugin slots default to `stub` mode — the app is fully functional with no external API keys.

---

## Background jobs

Jobs run via `pg-boss` (Postgres-backed queue). They are registered once at server startup via `src/instrumentation.ts` and run on schedule automatically.

| Job | Default schedule | What it does |
|---|---|---|
| `poll-creative-status` | Every minute | Polls the video generator for in-progress jobs; downloads finished videos; flags timeouts. |
| `sync-performance` | Every 6 hours | Fetches daily analytics snapshots for all published posts; detects creative fatigue. |
| `trend-context` | Daily at 06:00 | Fetches Google Trends + web search + competitor ads; synthesises a `TrendContext` via Claude; re-scores all pending ideas. |
| `feedback-loop` | Daily at 08:00 | Reads 30-day performance data, assembles a `PerformanceContext`, calls the idea generator for 5 new ideas based on what's winning. |

### Overriding schedules

Set any of these in `.env.local` using cron syntax:

```
CRON_TREND_CONTEXT=0 6 * * *
CRON_FEEDBACK_LOOP=0 8 * * *
CRON_SYNC_PERFORMANCE=0 */6 * * *
CRON_POLL_CREATIVES=*/1 * * * *
```

### Triggering jobs manually

Every job has an API endpoint for one-off runs:

```bash
curl -X POST http://localhost:3000/api/trends/refresh
curl -X POST http://localhost:3000/api/performance/sync
```

---

## Plugin architecture

Every external vendor is behind a typed interface in `src/lib/plugins/interfaces.ts`. The active implementation for each slot is selected by an environment variable in `src/lib/plugins/registry.ts`. Business logic never calls a vendor API directly.

### Plugin slots

| Slot | Env var | Current options |
|---|---|---|
| Idea generator | `IDEA_GENERATOR` | `claude`, `stub` |
| Video generator | `VIDEO_GENERATOR` | `higgsfield`, `kling`, `runway`, `stub` |
| Image generator | `IMAGE_GENERATOR` | `stub` |
| Meta publisher | `PUBLISHER_META` | `meta`, `stub` |
| Meta analytics | `ANALYTICS_META` | `meta`, `stub` |
| Trend data | `TREND_DATA` | `google`, `stub` |
| Web search | `WEB_SEARCH` | `claude`, `stub` |
| Ad library | `AD_LIBRARY` | `meta`, `stub` |

### Switching from stub to real mode

Set the env var to the real adapter name, then provide the required API key:

```bash
# Turn on real Claude idea generation
IDEA_GENERATOR=claude
ANTHROPIC_API_KEY=sk-ant-...

# Turn on real Google Trends
TREND_DATA=google
# (no extra key needed — google-trends-api makes public requests)

# Turn on real Meta publishing
PUBLISHER_META=meta
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_ID=...
```

### Adding a new video generator

1. Create `src/lib/plugins/yourvendor/index.ts` and implement `VideoGeneratorPlugin`:

```ts
import type { VideoGeneratorPlugin } from '../interfaces'

export class YourVendorGenerator implements VideoGeneratorPlugin {
  name = 'yourvendor'

  async submitJob({ idea }) {
    // POST to their API, return { jobId }
  }

  async pollJobStatus(jobId) {
    // GET their status endpoint
    // Return { status: 'pending' | 'processing' | 'complete' | 'failed', fileUrl? }
  }
}
```

2. Register it in `src/lib/plugins/registry.ts`:

```ts
import { YourVendorGenerator } from './yourvendor'

export function getVideoGenerator(): VideoGeneratorPlugin {
  switch (env('VIDEO_GENERATOR')) {
    case 'yourvendor': return new YourVendorGenerator()
    case 'higgsfield': return new HiggsfieldGenerator()
    // ...
  }
}
```

3. Set `VIDEO_GENERATOR=yourvendor` in `.env.local`.

That's it — no other code changes needed. The `poll-creative-status` job and the `/api/creatives/generate` route will automatically use the new adapter.

---

## Trend context system

The trend context pipeline runs daily and provides the idea generator with fresh market intelligence.

### How it works

1. **`trend-context` job (06:00)** calls three data sources in parallel:
   - **Google Trends** (`TREND_DATA=google`) — interest-over-time scores (0–100) for ~17 EV-relevant topics
   - **Web search** (`WEB_SEARCH=claude`) — current ad format trends, platform algorithm news, EV consumer sentiment
   - **Meta Ad Library** (`AD_LIBRARY=meta`) — what competitor EV brands are running right now

2. Claude synthesises all three into a `TrendContext` record containing:
   - A narrative `summary`
   - `risingTopics` and `decliningTopics` with scores and rationale
   - `platformFormatTrends` (UGC, talking-head, cinematic, text-on-screen)
   - `competitorAdInsights`
   - `topicScores` — a `{ topic: float }` map used for idea freshness scoring

3. **Idea re-scoring**: after saving the new `TrendContext`, every `pending` and `selected` idea is re-scored. Each idea has `trendTags` (e.g. `["road_trip_season", "ev_lifestyle"]`) that were attached at generation time. The job averages the `topicScores` for those tags to compute a new `trendScore` (0–1). If the score drops below 0.3, a `trendWarning` is written and an `AgentAction` of type `idea_demoted_stale_trend` is logged.

### What idea staleness looks like in the UI

- **Green dot** (score ≥ 0.6): idea is riding currently-rising topics
- **Amber dot** (0.3–0.6): trending down, watch before investing in production
- **Red dot** (< 0.3): stale — ideas are faded and show a warning banner, but are never hidden

The `/trends` page shows the full staleness table and topic score history across multiple `TrendContext` runs.

---

## Feedback loop

The feedback loop (08:00 daily, after trend context) closes the cycle from performance data back to new creative briefs.

### Step by step

1. Pulls the last 30 days of `PerformanceSnapshot` records from the DB.
2. Identifies top 3 and bottom 3 creatives by ROAS, plus any fast-fatiguers (frequency spike + ROAS drop within 7 days).
3. Asks Claude to extract the creative patterns that drove top performance (hook style, visual type, angle, trend tags used).
4. Asks Claude to hypothesise why poor performers underperformed (mismatched audience? stale trend? weak hook?).
5. Assembles a `PerformanceContext` with winning patterns, patterns to avoid, and full top/bottom performer profiles.
6. Fetches the latest `TrendContext` from the DB.
7. Calls the idea generator with both contexts, requesting 5 new ideas that build on winning patterns and rising trends.
8. Saves new ideas — with `parentIdeaId` pointing to the top performer they were inspired by.
9. Immediately validates new ideas' `trendTags` against the current `topicScores`. Flags any with average score < 0.5.
10. Logs an `AgentAction` with a full rationale.

The same `PerformanceContext` assembly logic is used by the manual "Generate ideas" button on the `/ideas` page — there is no duplication; both call `src/lib/performance-context.ts`.
