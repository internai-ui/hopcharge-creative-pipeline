# Hopcharge Ad Engine

An internal automated marketing pipeline for Hopcharge. It orchestrates the full lifecycle of an ad creative — AI-generated idea matrices → image/video generation → human review → publishing to Meta → performance analytics → feeding winning patterns back into idea generation — continuously and on schedule.

> Built on **Next.js 16** (App Router) + **React 19**, **Prisma 7** / PostgreSQL, **pg-boss** for scheduled jobs, **Playwright** for browser-automation generators, and S3-compatible object storage (MinIO in dev, R2/S3 in prod). All performance metrics are in **₹ (INR)** and the engine optimises for **CPL** (cost-per-lead, lower is better).

> **Note for contributors:** This repo pins Next.js 16, which has breaking changes vs. older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code (see `AGENTS.md`).

---

## Pages

| Page | URL | What it does |
|---|---|---|
| Ideas | `/ideas` | Ranked, drag-to-reorder idea matrix. Generate AI ideas, add ideas manually, inline-edit fields, filter by trend health and funnel stage (TOF/MOF/BOF), select ideas for production. |
| Review | `/review` | Grid of generated creatives (image + video). Watch/preview, re-upload human-edited versions, approve or reject. |
| Publish | `/publish` | Queue approved creatives for Meta (or YouTube). Schedule with day/hour ad-scheduling windows or post immediately. Retry failed posts. |
| Performance | `/performance` | Analytics dashboard — CPL over time, spend vs. impressions, sortable per-creative table, daily snapshot drill-down, best-time-to-run timing analysis. |
| Trends | `/trends` | Live trend intelligence — rising/declining topics, platform format trends, competitor ad insights, idea staleness table, topic score history chart. |
| Evaluation | `/evaluation` | Pipeline health — active issues by severity, agent decision log, human override rate, AI-generated evaluation report. |

---

## Running locally

### Prerequisites
- Node.js 20+
- PostgreSQL 14+ (running locally or remote)
- Docker (for local MinIO object storage)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in at minimum DATABASE_URL
cp .env.example .env.local

# 3. Start local object storage (MinIO) — creates the creatives bucket
npm run storage:up

# 4. Push schema to your database
npm run db:push

# 5. Seed with demo data (ideas, creatives, 30 days of perf snapshots, etc.)
npm run db:seed

# 6. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to `/ideas`. If `INTERNAL_PASSWORD` is set in `.env.local`, you'll be prompted to log in first.

> **All plugin slots default to `stub` mode** — the app is fully functional with no external API keys.

### MinIO (local object storage)

`npm run storage:up` runs MinIO via `docker-compose.yml` and auto-creates the `hopcharge-creatives` bucket.

- S3 API: `http://localhost:9000`
- Web console: `http://localhost:9001` (login `minioadmin` / `minioadmin`)
- `npm run storage:down` stops it; `npm run storage:reset` wipes the volume.

To go to production, leave the code untouched and point the `AWS_*` env vars at Cloudflare R2 or real S3 (see `.env.example`). Set `STORAGE_TYPE=local` to skip object storage and use plain disk (`STORAGE_LOCAL_PATH`).

### Useful scripts

| Command | Purpose |
|---|---|
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:migrate` | Create/apply a dev migration |
| `npm run meta:setup` | Verify Meta credentials / ad account |
| `npm run classify-funnel` | Backfill `funnelStage` on existing ideas |
| `npm run backfill-ad-copy` | Backfill `primaryText` / `headline` ad copy |
| `npm run browser:setup:<vendor>` | Launch a real browser to capture a login session for a browser-automation generator (`kling`, `veo`, `runway`, `flux`, `flyne`) |

---

## Background jobs

Jobs run via `pg-boss` (Postgres-backed queue). They're registered once at server startup (`src/lib/jobs/index.ts`, invoked from instrumentation) and run on schedule automatically.

| Job | Default schedule | What it does |
|---|---|---|
| `poll-creative-status` | Every minute | Polls the active generator for in-progress jobs; downloads finished media to storage; flags timeouts. |
| `sync-performance` | Every 6 hours | Fetches daily analytics snapshots for all published posts; detects creative fatigue. |
| `trend-context` | Daily at 06:00 | Fetches Google Trends + web search + competitor ads; synthesises a `TrendContext`; re-scores all pending ideas. |
| `feedback-loop` | Daily at 08:00 | Reads 30-day performance, assembles a `PerformanceContext`, asks the idea generator for new ideas based on what's winning (by CPL). |

A `reconcile-posts` job (`src/lib/jobs/reconcile-posts.ts`) also exists to detect ads deleted in Meta Ad Manager after publishing; trigger it via `POST /api/posts/reconcile`.

### Overriding schedules

Set any of these in `.env.local` using cron syntax:

```
CRON_TREND_CONTEXT=0 6 * * *
CRON_FEEDBACK_LOOP=0 8 * * *
CRON_SYNC_PERFORMANCE=0 */6 * * *
CRON_POLL_CREATIVES=*/1 * * * *
```

### Triggering jobs manually

```bash
curl -X POST http://localhost:3000/api/trends/refresh
curl -X POST http://localhost:3000/api/performance/sync
curl -X POST http://localhost:3000/api/posts/reconcile
```

---

## Plugin architecture

Every external vendor sits behind a typed interface in `src/lib/plugins/interfaces.ts`. The active implementation for each slot is selected by an environment variable in `src/lib/plugins/registry.ts`. **Business logic never calls a vendor API directly.**

### Plugin slots

| Slot | Env var | Options |
|---|---|---|
| Idea generator | `IDEA_GENERATOR` | `claude`, `stub` |
| Video generator | `VIDEO_GENERATOR` | `higgsfield`, `kling`, `runway`, `browser-kling`, `browser-veo`, `browser-runway`, `stub` |
| Image generator | `IMAGE_GENERATOR` | `higgsfield`, `replicate`, `browser-flux`, `browser-flyne`, `stub` |
| Meta publisher | `PUBLISHER_META` | `meta`, `stub` |
| Meta analytics | `ANALYTICS_META` | `meta`, `stub` |
| Trend data | `TREND_DATA` | `google`, `stub` |
| Web search | `WEB_SEARCH` | `claude`, `stub` |
| Ad library | `AD_LIBRARY` | `meta`, `stub` |

> **Higgsfield is credit-gated.** `HIGGSFIELD_ALLOW_GENERATION` must be `true` to actually spend credits — keep it off unless you intend to.

The `browser-*` generators drive a real vendor web UI with Playwright instead of an API. Capture a login session first with `npm run browser:setup:<vendor>` (sessions are stored in `.browser-session-*.json`).

### Switching from stub to real mode

Set the env var to the real adapter name, then provide the required key(s):

```bash
# Real Claude idea generation
IDEA_GENERATOR=claude
ANTHROPIC_API_KEY=sk-ant-...

# Real Google Trends (no key needed — public requests)
TREND_DATA=google

# Real Meta publishing
PUBLISHER_META=meta
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_ID=...
```

### Adding a new video generator

1. Implement `VideoGeneratorPlugin` (see `src/lib/plugins/interfaces.ts`) in a new folder under `src/lib/plugins/`.
2. Add a `case` for it in `getVideoGenerator()` in `src/lib/plugins/registry.ts`.
3. Set `VIDEO_GENERATOR=yourvendor` in `.env.local`.

No other changes needed — `poll-creative-status` and `/api/creatives/generate` use the registry.

---

## Trend context system

The `trend-context` job runs daily and gives the idea generator fresh market intelligence.

1. Calls up to three data sources in parallel:
   - **Google Trends** (`TREND_DATA=google`) — interest-over-time scores (0–100) for EV-relevant topics.
   - **Web search** (`WEB_SEARCH=claude`) — ad-format trends, platform algorithm news, EV consumer sentiment.
   - **Meta Ad Library** (`AD_LIBRARY=meta`) — what competitor EV brands are running now.
   - `TREND_MODE=lite` uses Google Trends only (free, no AI); `full` adds Claude web search & synthesis.
2. Claude synthesises a `TrendContext`: `summary`, `risingTopics`/`decliningTopics`, `platformFormatTrends`, `competitorAdInsights`, and a `topicScores` map.
3. **Idea re-scoring:** every `pending`/`selected` idea is re-scored by averaging `topicScores` for its `trendTags`. A score < 0.3 writes a `trendWarning` and logs an `AgentAction`.

### Staleness in the UI
- **Green** (≥ 0.6): riding currently-rising topics
- **Amber** (0.3–0.6): trending down — watch before investing in production
- **Red** (< 0.3): stale — faded with a warning banner, never hidden

The `/trends` page shows the full staleness table and topic-score history.

---

## Feedback loop

The feedback loop (08:00 daily, after trend context) closes the cycle from performance back to new creative briefs.

1. Pulls the last 30 days of `PerformanceSnapshot` records.
2. Identifies top/bottom creatives by **CPL** (₹, lower is better) plus fast-fatiguers (frequency spike + CPL rise within 7 days).
3. Asks Claude to extract the patterns behind top performers and hypothesise why poor performers underperformed.
4. Assembles a `PerformanceContext` (winning patterns, patterns to avoid, full top/bottom profiles).
5. Fetches the latest `TrendContext` and asks the idea generator for new ideas built on winning patterns + rising trends.
6. Saves new ideas with `parentIdeaId` pointing to the top performer they were inspired by, validates their `trendTags`, and logs an `AgentAction`.

The same assembly logic powers the manual **Generate ideas** button on `/ideas` — both call `src/lib/performance-context.ts`, no duplication.

---

## Meta historical import

`HistoricalAd` records (imported via `POST /api/meta/import`) hold past Meta ad performance — body/headline copy, CPL, leads, spend, and hourly/weekday breakdowns. These seed the performance context and the best-time-to-run timing analysis on `/performance`.

---

## Project layout

```
src/
  app/
    (app)/            # authenticated UI pages (ideas, review, publish, performance, trends, evaluation)
    api/              # route handlers (ideas, creatives, posts, performance, trends, meta, pipeline)
  components/         # per-page React components
  lib/
    jobs/             # pg-boss jobs (poll, sync, trend-context, feedback-loop, reconcile)
    plugins/          # vendor adapters behind typed interfaces + registry
      browser/        # Playwright-driven generators (kling, veo, runway, flux, flyne)
      claude/ meta/ google-trends/ higgsfield/ kling/ runway/ replicate/ stubs/
    storage.ts        # S3/local storage abstraction
    performance-context.ts, trend-topics.ts, meta-historical.ts, ...
prisma/               # schema.prisma + seed.ts
scripts/              # setup & backfill utilities
docker-compose.yml    # local MinIO object storage
```

See `.env.example` for the full list of configuration variables.
