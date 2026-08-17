# Hopcharge Ad Engine

An internal automated marketing pipeline for Hopcharge. It orchestrates the full lifecycle of an ad creative - AI-generated idea matrices → image/video generation → human review → publishing to **Meta and YouTube** → performance analytics → feeding winning patterns back into idea generation - continuously and on schedule.

> Built on **Next.js 16** (App Router) + **React 19**, **Prisma 7** / PostgreSQL, **pg-boss** (or **Vercel Cron** on serverless) for scheduled jobs, S3-compatible object storage (MinIO in dev, R2/S3 in prod), and **ffmpeg** for logo/headline/outro video post-processing. Meta metrics are in **₹ (INR)**, optimising for **CPL** (cost-per-lead, lower is better); YouTube is organic (no spend/CPL), ranked by engagement rate instead.
>
> The whole app is gated behind **Google OAuth restricted to `@hopcharge.com`** (`src/proxy.ts` + `src/lib/auth.ts`) - there is no separate password, and every route (pages and APIs) requires a signed-in session except `/signin` and `/api/auth/*`.

> **Note for contributors:** This repo pins Next.js 16, which has breaking changes vs. older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code (see `AGENTS.md`).

---

## Pages

| Page | URL | What it does |
|---|---|---|
| Ideas | `/ideas` | Ranked, drag-to-reorder idea matrix. Generate AI ideas, add ideas manually, inline-edit fields, filter by trend health and funnel stage (TOF/MOF/BOF), select ideas for production. Generate/regenerate prompts for **Meta or YouTube** independently (a per-idea platform picker). Import ad/video history from Meta and YouTube in one click. |
| Review | `/review` | Grid of generated creatives (image + video). Watch/preview, re-upload human-edited versions (including pasted results from **manual mode**), approve or reject. Polls in-progress generations and completes them automatically. |
| Publish | `/publish` | Queue approved creatives to **Meta or YouTube**. Meta: schedule with day/hour ad-scheduling windows, post immediately, or save as a paused draft; retry failed posts; pause/resume live ads. YouTube: publish as a Short (private draft or public), watch it live, unpublish/republish. Filter by platform; browse everything imported from ad/history import. |
| Performance | `/performance` | Analytics dashboard with **separate Meta and YouTube views** (paid vs. organic metrics don't mix on one scale) - CPL/spend/impressions for Meta, views/likes/comments/engagement rate for YouTube, sortable per-creative tables, daily snapshot drill-down, seasonal breakdown, and best-time-to-run timing analysis (Meta only). Full CSV export across both platforms and all time. |
| Trends | `/trends` | Live trend intelligence - rising/declining topics, platform format trends, competitor ad insights, idea staleness table, topic score history chart. |
| Evaluation | `/evaluation` | Pipeline health - active issues by severity, agent decision log, human override rate, AI-generated evaluation report. |
| Automation | `/automation` | Control the background jobs that run the pipeline on a schedule. Master switch plus a per-job on/off toggle and editable cron; **Run now** fires any job immediately. Changes apply live - no restart. |

---

## Authentication

Every page and API route is gated behind Google Sign-In, restricted to verified `@hopcharge.com` Google Workspace accounts (`isAllowedIdentity` in `src/lib/auth.ts` checks Google's `hd` claim, which can't be spoofed by the client). There's no local username/password and no bypass - this is required, not optional, in both dev and prod.

- `src/proxy.ts` runs on every route except `/signin` and `/api/auth/*` (and `/api/cron/*`, which is authenticated separately with `CRON_SECRET`). No session → pages redirect to `/signin?next=...`, API calls get a `401`.
- Sessions are a signed JWT (`jose`, HS256) in an `hc_session` cookie, verified with `AUTH_SECRET`; PKCE-based OAuth code exchange lives in `src/app/api/auth/{signin,callback/google,signout}`.
- **Setup:** create an OAuth 2.0 "Web application" client in Google Cloud Console with redirect URI `http://localhost:3000/api/auth/callback/google` (and your prod URL), then set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `AUTH_SECRET` (`openssl rand -base64 32`) in `.env.local`. If unset, `/signin` itself errors - the app fails closed.

---

## Running locally

### Prerequisites
- **Node.js 20+** and npm
- **PostgreSQL 14+** running and reachable (local or remote). Prisma creates the database named in `DATABASE_URL` if it doesn't exist - you only need the server running and credentials that can create databases.
- **Docker** (only for local MinIO object storage; skippable - see step 3).
- **ffmpeg + ffprobe on PATH** - used for the logo/headline video overlays, the outro-clip append, and turning YouTube image creatives into video. Overlay/outro steps degrade gracefully (original media returned) if ffmpeg is missing, but `still-to-video.ts` (required for publishing an image creative to YouTube) throws without it.
- **A Google OAuth client** for sign-in (see [Authentication](#authentication)) - the app will not load without it.

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your env file. At minimum set DATABASE_URL to a reachable Postgres,
#    plus AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET so you can sign in.
#    The Prisma CLI reads .env.local via prisma.config.ts, so this one file
#    covers both the app and the db:* scripts.
cp .env.example .env.local

# 3. Start local object storage (MinIO) - creates the creatives bucket.
#    Needed at runtime to store/serve generated media (the default
#    STORAGE_TYPE=s3). Not required for db:seed.
#    To skip Docker entirely, set STORAGE_TYPE=local in .env.local instead.
npm run storage:up

# 4. Create tables and generate the Prisma client (db:push does both)
npm run db:push

# 5. Seed with demo data (ideas, creatives, 30 days of perf snapshots, etc.)
npm run db:seed

# 6. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) - you'll be redirected to `/signin`, then to `/ideas` after signing in with a `@hopcharge.com` Google account.

> **All plugin slots default to `stub` mode** - the app is fully functional (minus real generation/publishing/auth) with no external API keys, other than the Google OAuth client required for sign-in itself.
>
> **Background job automation ships OFF.** Nothing runs on a schedule until you flip the master switch on the `/automation` page (its first-boot default is seeded from `ENABLE_JOB_AUTOMATION`, which ships `false`). See [Daily operation](#daily-operation) and [Enabling automation](#enabling-automation). Either way, `DATABASE_URL` must point at a reachable Postgres at startup; when automation is on outside Vercel, pg-boss creates its own queue tables on first run.

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

---

## Pipeline flow

The engine is a loop. Each stage hands off to the next; some stages are automated, some **require a human**, and the human gates are deliberate - they're the points where money is spent (generation credits, ad spend) or brand judgement is needed.

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                        │
   ▼                                                                        │
[1] IDEATION ──▶ [2] SELECTION ──▶ [3] PRODUCTION ──▶ [4] REVIEW ──▶ [5] PUBLISH
  AI/auto          HUMAN              AI + human kick    HUMAN          HUMAN
                                                                          │
                                                                          ▼
                                              [7] FEEDBACK ◀── [6] ANALYTICS
                                                AI/auto           auto
```

| # | Stage | Page | Who does it | What happens |
|---|---|---|---|---|
| 1 | **Ideation** | `/ideas` | Automated *(or click)* | Claude generates ranked idea matrices from performance + trend context. The `feedback-loop` job does this on a schedule; the **Generate ideas** button does the same on demand. You can also add ideas by hand. |
| 2 | **Selection** | `/ideas` | **Human** | You decide which ideas are worth producing - reorder, edit copy, and mark ideas `selected`. Nothing is produced without this. |
| 3 | **Production** | `/ideas` → `/review` | **Human kicks off**, generation runs | You click **Generate** on a selected idea, choosing **Meta or YouTube** (spends generation credits). The image/video generator runs async; the creative appears as `generating`. In **manual mode** (`VIDEO_GENERATOR=manual` / `IMAGE_GENERATOR=manual`, or a per-generation toggle) no API is called - the app shows the exact prompt to paste into a tool by hand, and you upload the result back in on `/review`. |
| 4 | **Review** | `/review` | **Human** | Watch the finished creative, optionally re-upload a human-edited cut, then **approve** or **reject**. Approval is required to publish. |
| 5 | **Publish** | `/publish` | **Human** | Queue an approved creative to **Meta** (post now or schedule with day/hour windows, spends ad budget) or **YouTube** (publish as a Short, private draft or public - organic, no budget). Retry failures here. |
| 6 | **Analytics** | `/performance` | Automated *(or click)* | Daily snapshots are pulled per post - spend/CPL/impressions/leads for Meta, views/likes/comments for YouTube; fatigue is flagged. The `sync-performance` job does this on a schedule; **Sync now** does it on demand. |
| 7 | **Feedback** | - → `/ideas` | Automated *(or click)* | Performance from both platforms is distilled into winning/avoid patterns (ranked separately - Meta by CPL, YouTube by engagement rate) and fed back into ideation (stage 1), closing the loop. |

Two supporting automations run alongside the loop:
- **Trend context** (`trend-context` job / **Refresh** on `/trends`) - refreshes market intelligence and re-scores idea freshness.
- **Poll creative status** (`poll-creative-status` job / automatic on the `/review` page) - completes `generating` creatives by downloading finished media, running it through the logo/headline/outro post-processing pipeline (see [Video post-processing](#video-post-processing)).

### What is automated vs. what needs a human

| Always automated (agents/jobs) | Always a human decision |
|---|---|
| Generating idea candidates & ranking them | **Selecting** which ideas to produce |
| Scoring idea freshness against trends | **Spending credits** by clicking Generate |
| Downloading finished creatives + post-processing (logo/headline/outro) | **Approving / rejecting** a creative |
| Pulling performance snapshots & flagging fatigue | **Publishing** & setting ad schedule/budget (or YouTube visibility) |
| Distilling winning patterns for the next idea batch | Editing copy, reordering, manual ideas |

> The agents **propose**; humans **commit** anything that costs money or represents the brand. Even with full automation enabled, stages 2, 4, and 5 still wait for you.

---

## Daily operation

Two modes depending on the [automation switch](#enabling-automation). **Today the engine ships with automation OFF**, so start with the first checklist.

### A) Day-to-day with automation OFF *(current default)*

Nothing runs on a timer - you drive each stage. A normal day:

1. **Refresh trends** *(optional, ~weekly is fine)* - `/trends` → **Refresh**, so new ideas are scored against current trends.
2. **Generate / review ideas** - `/ideas` → **Generate ideas** (pulls in latest performance + trend context), then triage: reorder, edit copy, and mark the keepers `selected`.
3. **Kick off production** - on each `selected` idea, click **Generate**, choose **Meta** or **YouTube**, to produce the creative. (This is the credit-spending step - do it deliberately.)
4. **Finish the creatives** - open `/review`. The page polls each `generating` creative and downloads it when ready. Approve or reject; re-upload edited cuts if needed.
5. **Publish** - `/publish`: queue approved creatives to Meta or YouTube, post now/publish or schedule (Meta only), and retry any failures.
6. **Pull performance** - `/performance` → **Sync now** to refresh metrics for live posts on both platforms. (Do this daily-ish to keep the feedback signal fresh.)
7. **Reconcile** *(occasional)* - if you delete ads in Meta Ads Manager (or videos in YouTube Studio), hit `POST /api/posts/reconcile` so the queue reflects reality.

Equivalent manual triggers, if you prefer the terminal:

```bash
curl -X POST http://localhost:3000/api/trends/refresh       # trend context
curl -X POST http://localhost:3000/api/performance/sync      # analytics snapshots
curl -X POST http://localhost:3000/api/posts/reconcile       # detect deleted ads/videos
curl -X POST http://localhost:3000/api/ads/import-history     # import ad/video history from Meta + YouTube
```

### B) Day-to-day with automation ON

Once you flip the master switch on the `/automation` page, the scheduled jobs handle the *timing* of ideation, trend refresh, analytics, and creative downloads for you. Your day shrinks to the **human gates only**:

1. **Triage the morning's ideas** - the `feedback-loop` + `trend-context` jobs (06:00 / 08:00) will have produced fresh, trend-scored ideas overnight. On `/ideas`, review them and mark keepers `selected`.
2. **Kick off production** - click **Generate** on selected ideas, choosing a platform. *(Still manual by design - this spends credits.)*
3. **Review creatives** - `/review` populates automatically as `poll-creative-status` downloads finished media. Approve/reject. *(Still manual by design.)*
4. **Publish** - `/publish`: approve → queue/schedule to Meta or publish to YouTube. *(Still manual by design.)*
5. **Glance at performance** - `/performance` is kept current by `sync-performance` (every 6h); just check for fatigue flags and let the numbers feed the next idea batch.

In short: **automation removes the "remember to refresh/sync/generate-ideas/download" chores; it never auto-spends credits, auto-approves, or auto-publishes.** Those three gates are always yours.

---

## Background jobs

> The full job system is built on `pg-boss` (a Postgres-backed queue) for long-running hosts, and ready to go - but it ships with the master switch **off**. Until you flip it on, nothing runs on a schedule - you operate the pipeline manually (see [Daily operation](#daily-operation)). Every job's logic is also exposed as an API endpoint / UI action, so manual mode loses no functionality - only the automatic *timing*.

Automation state is a singleton row in Postgres (`AutomationConfig`) controlled at runtime from the [`/automation` page](#enabling-automation) - a master switch, a per-job on/off toggle, and an editable cron per job. On a long-running host, workers are registered once at server startup (`src/lib/jobs/index.ts`, invoked from `src/instrumentation.ts`); toggling then schedules/unschedules them live, so no restart is needed. **On Vercel**, there's no long-lived process to host pg-boss, so `pg-boss` is skipped entirely and **Vercel Cron** drives the schedule instead by hitting `/api/cron/<job>` (see [Deployment on Vercel](#deployment-on-vercel)) - both paths read the same `AutomationConfig` row, so the `/automation` toggles control either transport identically.

| Job | Default schedule | What it does |
|---|---|---|
| `poll-creative-status` | Every minute | Polls the active generator for in-progress jobs; downloads finished media, runs it through the logo/headline/outro post-processing pipeline, and stores it. Flags timeouts. Not on Vercel Cron (too frequent for a cron interval) - runs via pg-boss or the `/review` page's own polling. |
| `sync-performance` | Every 6 hours (Vercel: daily at 05:00) | Fetches daily analytics snapshots for all published posts on both platforms; detects creative fatigue. |
| `trend-context` | Daily at 06:00 | Fetches Google Trends + web search + competitor ads; synthesises a `TrendContext`; re-scores all pending ideas. |
| `feedback-loop` | Daily at 08:00 | Reads 30-day performance across both platforms, assembles a `PerformanceContext`, asks the idea generator for new ideas based on what's winning (Meta by CPL, YouTube by engagement rate). |
| `reconcile-posts` | Every 12 hours (Vercel: daily at 17:00) | Detects ads/videos deleted on Meta or YouTube after publishing and marks them in the queue. |

### Enabling automation

Automation is controlled from the **`/automation` page**, not an env var - flip the **master switch** on and the enabled jobs start immediately (no restart). From the same page you can toggle each job independently, edit its cron (presets or a custom expression), and hit **Run now** to fire any job once, ignoring its schedule.

`ENABLE_JOB_AUTOMATION` in `.env.local` only **seeds the master switch's default on first boot** (it ships `false`); after that the state saved in Postgres wins and the `/automation` toggle is the source of truth. `src/instrumentation.ts` re-applies that saved state on restart, and pg-boss creates its own queue tables on first run, so no migration is needed.

### Overriding schedules

Edit any job's schedule from the `/automation` page, or set an env default (used until a UI override is saved) in `.env.local` using cron syntax:

```
CRON_TREND_CONTEXT=0 6 * * *
CRON_FEEDBACK_LOOP=0 8 * * *
CRON_SYNC_PERFORMANCE=0 */6 * * *
CRON_POLL_CREATIVES=*/1 * * * *
CRON_RECONCILE_POSTS=0 */12 * * *
```

On Vercel, the *actual* firing schedule is `vercel.json`'s `crons` array (Vercel doesn't read these env vars at the platform level) - edit that file and redeploy to change cadence there; the env vars above still set the default cron shown/used elsewhere.

### Triggering jobs manually

Use **Run now** on the `/automation` page, or `POST /api/automation/run` with a job name. The per-stage endpoints work too:

```bash
curl -X POST http://localhost:3000/api/automation/run -H 'Content-Type: application/json' -d '{"name":"trend-context"}'
curl -X POST http://localhost:3000/api/trends/refresh
curl -X POST http://localhost:3000/api/performance/sync
curl -X POST http://localhost:3000/api/posts/reconcile
```

---

## Deployment on Vercel

The app runs on Vercel with two adjustments handled automatically by the code:

1. **No pg-boss.** `process.env.VERCEL` being set short-circuits `initAutomation()`/`applyAutomation()` - nothing tries to start a long-lived Postgres-backed queue on a serverless function.
2. **Vercel Cron drives the schedule instead.** `vercel.json` declares GET crons hitting `/api/cron/trend-context`, `/api/cron/feedback-loop`, `/api/cron/sync-performance`, and `/api/cron/reconcile-posts`. Each endpoint (`src/app/api/cron/[job]/route.ts`) checks the `AutomationConfig` row before running, so the `/automation` page's master switch and per-job toggles still gate execution exactly as they do with pg-boss. `poll-creative-status` isn't on a Vercel cron (its 1-minute cadence doesn't fit a cron schedule well) - it runs client-side from the `/review` page's own polling instead.

Set `CRON_SECRET` and configure the same value in Vercel - Vercel sends it as `Authorization: Bearer $CRON_SECRET` on every scheduled call, and the cron endpoints reject any other caller. **If left unset, `/api/cron/*` is unauthenticated.** Also remember `ENABLE_JOB_AUTOMATION=true` (or flip the `/automation` master switch once post-deploy) - crons fire on schedule either way, but each run is a no-op until automation is turned on.

---

## Plugin architecture

Every external vendor sits behind a typed interface in `src/lib/plugins/interfaces.ts`. The active implementation for each slot is selected by an environment variable in `src/lib/plugins/registry.ts`. **Business logic never calls a vendor API directly.**

### Plugin slots

| Slot | Env var | Options |
|---|---|---|
| Idea generator | `IDEA_GENERATOR` | `claude`, `stub` |
| Video generator | `VIDEO_GENERATOR` | `higgsfield`, `kling`, `runway`, `manual`, `stub` |
| Image generator | `IMAGE_GENERATOR` | `higgsfield`, `replicate`, `manual`, `stub` |
| Meta publisher | `PUBLISHER_META` | `meta`, `stub` |
| YouTube publisher | `PUBLISHER_YOUTUBE` | `youtube`, `stub` |
| Meta analytics | `ANALYTICS_META` | `meta`, `stub` |
| YouTube analytics | `ANALYTICS_YOUTUBE` | `youtube`, `stub` |
| Trend data | `TREND_DATA` | `google`, `stub` |
| Web search | `WEB_SEARCH` | `brave` (free, default once `BRAVE_API_KEY` is set), `claude` (paid), `stub` |
| Ad library | `AD_LIBRARY` | `meta`, `stub` |

> **Higgsfield is credit-gated.** `HIGGSFIELD_ALLOW_GENERATION` must be `true` to actually spend credits - keep it off unless you intend to.
>
> **`manual` mode** for `VIDEO_GENERATOR` / `IMAGE_GENERATOR` calls no API at all: the app shows the exact prompt + config to paste into a tool (e.g. Higgsfield's web UI) by hand, and you upload the finished file back in on `/review`. Useful when you want a human in the loop on every generation, or a vendor has no API. Can also be toggled per-generation from `/ideas` regardless of the env default.

### Switching from stub to real mode

Set the env var to the real adapter name, then provide the required key(s):

```bash
# Real Claude idea generation
IDEA_GENERATOR=claude
ANTHROPIC_API_KEY=sk-ant-...

# Real Google Trends (no key needed - public requests)
TREND_DATA=google

# Real Meta publishing
PUBLISHER_META=meta
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_ID=...

# Real YouTube publishing (organic Shorts, not paid ads) - see .env.example for the
# OAuth scopes needed to mint YOUTUBE_REFRESH_TOKEN
PUBLISHER_YOUTUBE=youtube
ANALYTICS_YOUTUBE=youtube
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
YOUTUBE_REFRESH_TOKEN=...
```

### Adding a new video generator

1. Implement `VideoGeneratorPlugin` (see `src/lib/plugins/interfaces.ts`) in a new folder under `src/lib/plugins/`.
2. Add a `case` for it in `getVideoGenerator()` in `src/lib/plugins/registry.ts`.
3. Set `VIDEO_GENERATOR=yourvendor` in `.env.local`.

No other changes needed - `poll-creative-status` and `/api/creatives/generate` use the registry.

---

## Video post-processing

Diffusion/video models render in-frame text as garbled mush and can't reliably reproduce a real logo, so both are composited on afterward with ffmpeg/sharp instead of being prompted for - this runs automatically on every finished creative (`poll-creative-status`), in a fixed order:

1. **Logo overlay** (`logo-overlay.ts` for images, `video-logo-overlay.ts` for video) - stamps the real Hopcharge logo onto a corner (default bottom-right) of every generated creative, since the van itself is rendered unbranded in the prompt. `LOGO_OVERLAY_ENABLED=false` disables it entirely; `LOGO_OVERLAY_VIDEO=false` disables only the video half. Position/size/opacity/chip are configurable (`LOGO_OVERLAY_CORNER`, `_WIDTH_PCT`, `_MARGIN_PCT`, `_OPACITY`, `_CHIP`).
2. **Headline overlay** (`headline-overlay.ts` / `video-headline-overlay.ts`) - burns a solid-colour band with the idea's headline into the frame (default: top ~24%, navy `#222E53` with a gold `#D9A441` divider rule - the brand colours) so the ad carries its own message. The image prompt itself is asked to keep that region visually calm (`buildTextSafeZoneGuardrail` in `prompt-constants.ts`) so the band reads as designed, not slapped on. `HEADLINE_OVERLAY_ENABLED=false` disables both, `HEADLINE_OVERLAY_VIDEO=false` disables only video.
3. **Outro clip** (`video-append-clip.ts`, **video only**) - appends a fixed branded outro (`public/hopcharge_logo_clip.mp4` by default) after the main clip, run *after* the logo/headline overlays so the outro's own frames are never captioned. Handles mismatched resolution/fps/audio (letterboxes, synthesizes silence) before concatenating. `OUTRO_CLIP_ENABLED=false` disables it; `OUTRO_CLIP_PATH` points at a different file.

All three steps fail open - if ffmpeg/ffprobe are missing or anything errors, the *original* media is returned unchanged rather than blocking the pipeline.

A related, YouTube-specific step: **`still-to-video.ts`** turns an image creative into an MP4 (looped for a fixed duration, with a subtle Ken Burns zoom capped small enough to respect the logo's corner margin) because `videos.insert` rejects stills outright - this one *throws* on failure rather than falling back, since there's no video to fall back to. `YOUTUBE_STILL_KEN_BURNS=false` / `YOUTUBE_STILL_VIDEO_DURATION` control it.

All of the above require **ffmpeg + ffprobe on PATH** (override with `FFMPEG_PATH` / `FFPROBE_PATH`).

---

## Sara - the recurring customer character

Every ad that shows the EV owner/customer uses the same character, "Sara" (full description in `src/lib/plugins/prompt-constants.ts` and `Sara/sara-description.md`), so customers never vary across the ad library - she's the single recognisable brand face. Not every ad needs her: van/EV-only hero shots, macro connector details, cityscapes, and infographic frames are used freely to break the monotony, and any *other* people (technician, bystanders, other owners) are deliberately varied instead of reusing her likeness. The idea generator is instructed to name her explicitly only when an idea's own visual actually features her, and the text-safe-zone guardrail (used by the headline overlay's target region, see above) only refers to "Sara's face" when she's actually in that shot - otherwise it just says "the main subject", so the prompt doesn't imply a person is present when the ad is product-led.

---

## Trend context system

The `trend-context` job runs daily and gives the idea generator fresh market intelligence.

1. Calls up to three data sources in parallel:
   - **Google Trends** (`TREND_DATA=google`) - interest-over-time scores (0–100) for EV-relevant topics.
   - **Web search** (`WEB_SEARCH=brave` or `claude`) - ad-format trends, platform algorithm news, EV consumer sentiment. Brave is free (Brave Search API + Readability article parsing); Claude's `web_search` tool is paid ($10/1000 searches) but does the trend/competitor synthesis regardless of which search source supplies the raw results.
   - **Meta Ad Library** (`AD_LIBRARY=meta`) - what competitor EV brands are running now.
   - `TREND_MODE=lite` uses Google Trends only (free, no AI); `full` adds web search & Claude synthesis.
2. Claude synthesises a `TrendContext`: `summary`, `risingTopics`/`decliningTopics`, `platformFormatTrends`, `competitorAdInsights`, and a `topicScores` map.
3. **Idea re-scoring:** every `pending`/`selected` idea is re-scored by averaging `topicScores` for its `trendTags`. A score < 0.3 writes a `trendWarning` and logs an `AgentAction`.

### Staleness in the UI
- **Green** (≥ 0.6): riding currently-rising topics
- **Amber** (0.3–0.6): trending down - watch before investing in production
- **Red** (< 0.3): stale - faded with a warning banner, never hidden

The `/trends` page shows the full staleness table and topic-score history.

---

## Feedback loop

The feedback loop (08:00 daily, after trend context) closes the cycle from performance back to new creative briefs.

1. Pulls the last 30 days of `PerformanceSnapshot` records across both platforms.
2. Identifies top/bottom creatives **ranked within their own platform** - Meta by CPL (₹, lower is better), YouTube by engagement rate (higher is better) - plus fast-fatiguers (frequency spike + CPL rise within 7 days, Meta only). Mixing the two onto one scale was a real bug this shape avoids: a YouTube post has no CPL, so ranking everything by CPL used to silently sort every YouTube post in as a "poor performer" by default.
3. Asks Claude to extract the patterns behind top performers and hypothesise why poor performers underperformed.
4. Assembles a `PerformanceContext` (winning patterns, patterns to avoid, full top/bottom profiles per platform).
5. Fetches the latest `TrendContext` and asks the idea generator for new ideas built on winning patterns + rising trends.
6. Saves new ideas with `parentIdeaId` pointing to the top performer they were inspired by, validates their `trendTags`, and logs an `AgentAction`.

The same assembly logic powers the manual **Generate ideas** button on `/ideas` - both call `src/lib/performance-context.ts`, no duplication.

---

## Ad/video history import

`HistoricalAd` records hold past performance imported from either platform - Meta's paid ad copy/CPL/leads/spend + hourly/weekday breakdowns (`src/lib/meta-historical.ts`), and YouTube's organic channel uploads with views/likes/comments (`src/lib/youtube-historical.ts`). These seed the performance context and (Meta only) the best-time-to-run timing analysis on `/performance`.

- `POST /api/ads/import-history` - imports history from **both** platforms in one call, each attempted independently (a missing/misconfigured credential on one doesn't block the other; per-platform errors come back in the response instead of throwing). This is what the **import** button on `/ideas` calls.
- `POST /api/ads/import-creatives` - pulls the actual creative media for each imported ad/video: the real image/video file for Meta (pass `{ "force": true }` to re-download ones that already exist), and the thumbnail for YouTube (the Data API has no video-file download endpoint, so `/publish` links out to the real video instead).
- `POST /api/meta/import` / `POST /api/meta/import-creatives` - the Meta-only equivalents, if you want to import just one platform.

---

## Project layout

```
src/
  app/
    (app)/            # authenticated UI pages (ideas, review, publish, performance, trends, evaluation, automation)
    api/               # route handlers (ideas, creatives, posts, performance, trends, meta, ads, auth, cron, pipeline)
    signin/            # sign-in page
  components/          # per-page React components
  lib/
    jobs/              # pg-boss jobs (poll, sync, trend-context, feedback-loop, reconcile-posts)
    plugins/           # vendor adapters behind typed interfaces + registry
      claude/ meta/ youtube/ google-trends/ brave/ higgsfield/ kling/ runway/ replicate/ stubs/
    storage.ts         # S3/local storage abstraction
    auth.ts            # Google OAuth session signing/verification, domain gate
    headline-overlay.ts, logo-overlay.ts,            # image post-processing
    video-headline-overlay.ts, video-logo-overlay.ts, # video post-processing
    video-append-clip.ts, still-to-video.ts,          # outro append, image->video for YouTube
    performance-context.ts, trend-topics.ts, meta-historical.ts, youtube-historical.ts, ...
  proxy.ts             # auth middleware, runs on every route
prisma/                # schema.prisma + seed.ts
scripts/                # setup & backfill utilities
Sara/                  # reference description for the recurring customer character
public/hopcharge_logo_clip.mp4  # branded outro clip appended to generated videos
docker-compose.yml     # local MinIO object storage
vercel.json            # Vercel Cron schedule (serverless job triggers)
```

See `.env.example` for the full list of configuration variables.
