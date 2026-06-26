import { chromium } from 'playwright'
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// ---- Hopcharge logo (inlined so the PDF is self-contained) ----
const LOGO = readFileSync(path.join(root, 'public/hopcharge-logo.svg'), 'utf8')

// ---- Theme ----
const C = {
  progress: '#f3e1c4',
  issues: '#cdeafb',
  future: '#d9c9f5',
  needed: '#f9d3e4',
  nav: '#cfcfcf',
  navText: '#1c2440',
  titleBg: '#f6f6f6',
  cardBlue: '#bfe3f7',
  cardPink: '#f9cfe0',
  cardLime: '#cdf06f',
  cardGray: '#ececec',
  cardLav: '#e2d6f7',
  text: '#1a1d24',
}

const TABS = [
  { key: 'progress', label: 'Progress', color: C.progress },
  { key: 'issues', label: 'Issues', color: C.issues },
  { key: 'future', label: 'Future Work', color: C.future },
  { key: 'needed', label: 'Needed Resources', color: C.needed },
]

// Nav bar. active = section key | null. logoSide = 'left' | 'right' | 'none-left'
function nav(active, logoSide = 'left') {
  const logo = `<div class="navlogo">${LOGO}</div>`
  const tabs = TABS.map((t) => {
    const on = t.key === active
    return `<div class="navtab${on ? ' active' : ''}" style="${on ? `background:${t.color}` : ''}">${t.label}</div>`
  }).join('')
  if (logoSide === 'right') {
    return `<div class="nav">${`<div class="navtab spacer"></div>`}${tabs}${logo}</div>`
  }
  return `<div class="nav">${logo}${tabs}<div class="navtab spacer"></div></div>`
}

// Folder card
function card(color, title, bullets, opts = {}) {
  const items = bullets.map((b) => `<p>${b}</p>`).join('')
  return `<div class="card ${opts.cls || ''}" style="background:${color};${opts.style || ''}">
      <div class="card-tab" style="background:${color}"></div>
      <h3>${title}</h3>
      <div class="card-body">${items}</div>
    </div>`
}

function slide(active, bgColor, inner, logoSide = 'left') {
  return `<section class="slide" style="background:${bgColor}">
    ${nav(active, logoSide)}
    <div class="content">${inner}</div>
  </section>`
}

// ---------- SLIDES ----------
const slides = []

// 1. Title
slides.push(slide('progress', C.titleBg, `
  <div class="titleblock">
    <h1>Week 2 Progress</h1>
    <div class="rule"></div>
    <div class="author">Medhansh Garg</div>
  </div>
`))

// 2. Progress (4 folder cards)
slides.push(slide('progress', C.progress, `
  <div class="grid4">
    ${card(C.cardBlue, 'Sara — our customer character', [
      'Created Sara, a consistent recurring customer with a full character spec + 8 reference images',
      'Every ad now features Sara for visual consistency',
      'Generated many more image & video ads using Sara across Flux, Kling, Runway, Veo & Flyne (+ ElevenLabs audio)',
    ])}
    ${card(C.cardPink, 'Meta publishing integration', [
      'Live Meta Marketing API integration — campaigns, ad sets & ads',
      '60-day token exchange + least-privilege scopes (ads_management, pages_manage_ads, pages_read_engagement, pages_show_list)',
      'Draft-mode for safe testing; goals: reach (TOF) / conversions (MOF, BOF); WhatsApp-message CTA on every ad',
    ])}
    ${card(C.cardLime, 'Performance monitoring (real data)', [
      'Swapped stubs for real read-only Meta data, incl. historical ads',
      'Added reach column, clearer graphs & all-time view',
      'Normalized all spend to ₹ (INR, verified via Graph API); Meta vs YouTube separation & filtering',
    ])}
    ${card(C.cardGray, 'Storage, queues & idea upgrades', [
      'Pluggable media storage — local now, Cloudflare R2 via one env var, presigned URLs',
      'Postgres-backed job queue (pg-boss) with cron schedules: status polling, performance sync, trends, feedback loop',
      'Ideas now classified TOF/MOF/BOF with auto-generated primary text + headline; no-AI trends mode added',
    ])}
  </div>
`))

// 3. Blank media slide (for Sara images & videos)
slides.push(slide('progress', C.progress, `
  <div class="mediaslide">
    <h2 class="media-title">Generated Ads — Sara (Images &amp; Video)</h2>
    <div class="media-grid">
      <div class="media-box"><span>Add image / video</span></div>
      <div class="media-box"><span>Add image / video</span></div>
      <div class="media-box"><span>Add image / video</span></div>
      <div class="media-box"><span>Add image / video</span></div>
      <div class="media-box"><span>Add image / video</span></div>
      <div class="media-box"><span>Add image / video</span></div>
    </div>
  </div>
`))

// 4. Issues (2 wide cards)
slides.push(slide('issues', C.issues, `
  <div class="grid2">
    ${card(C.cardPink, 'Meta publishing & permissions', [
      'App still in Development mode — real ads can’t go fully live without Meta App Review',
      'Switched to draft-only publishing for testing; drafts save successfully to the ad account (e.g. ad 120246068407560491)',
      'Navigated scope requirements & the 60-day token exchange under a principle of least privilege',
    ], { cls: 'wide' })}
    ${card(C.cardGray, 'Generation, cost & storage', [
      'Anthropic credits exhausted → deterministic / manual fallbacks for idea generation while testing',
      'Gen-AI tools still gated by free-tier usage limits & browser-automation consent flows',
      'Truly-free object storage is scarce → running local now, R2-ready; earlier $ vs ₹ currency mismatch fixed',
    ], { cls: 'wide' })}
  </div>
`))

// 5. Future Work (8 cards, 2 rows)
const fwBlue = C.cardBlue, fwPink = C.cardPink, fwLime = C.cardLime, fwTan = '#f3e1c4', fwLav = C.cardLav
slides.push(slide('future', C.future, `
  <div class="grid8">
    ${card(fwBlue, 'Idea Generation', [
      'Optimize past-ad + trend input to minimize cost',
      'Refine TOF/MOF/BOF targeting & auto-copy quality',
    ], { cls: 'sm' })}
    ${card(fwPink, 'Image/Video Gen', [
      'Tune Sara prompts for cross-tool consistency',
      'Secure API/paid access to scale beyond free limits',
    ], { cls: 'sm' })}
    ${card(fwLime, 'Publishing', [
      'Complete Meta App Review to publish live ads',
      'Finish YouTube ad-upload integration',
    ], { cls: 'sm' })}
    ${card(fwTan, 'Creative testing', [
      'Enable A/B & multivariate testing across drafts',
      'Automated multivariate winner identification',
    ], { cls: 'sm' })}
    ${card(fwLav, 'Monitoring', [
      'Extend real-time Meta/YouTube dashboards',
      'Per-funnel KPIs: reach vs conversions',
    ], { cls: 'sm' })}
    ${card(fwLime, 'Orchestration', [
      'Cron-schedule all queues (trends, sync, polling, reconcile) for autonomous runs',
    ], { cls: 'sm' })}
    ${card(fwTan, 'Agent evaluation', [
      'Claude feedback loop extracts winning-ad features to reinforce idea generation',
    ], { cls: 'sm' })}
    ${card(fwBlue, 'Final testing', [
      'Validate the full pipeline end-to-end, independently and together',
    ], { cls: 'sm' })}
  </div>
`))

// 6. Needed Resources
slides.push(slide('needed', C.needed, `
  <div class="grid1">
    ${card(C.cardBlue, 'Required Resources', [
      'Meta App Review approval / go-live (to publish live ads, not just drafts)',
      'YouTube account or API access for ad upload',
      'Paid / API subscriptions for gen tools:',
      '<span class="sub">– Kling AI &nbsp; – Veo 3 (Google) &nbsp; – Higgsfield &nbsp; – Runway ML &nbsp; – Flux (via Replicate API) &nbsp; – Midjourney</span>',
      'Anthropic API credits (to run live Claude idea generation & feedback loop)',
      '(Optional) Cloudflare R2 / object-storage budget for production media; additional Sara reference angles &amp; outfits',
    ], { cls: 'tall' })}
  </div>
`))

// 7. Thank you
slides.push(slide(null, C.titleBg, `
  <div class="titleblock">
    <h1>Thank you!</h1>
    <div class="rule"></div>
  </div>
`, 'right'))

// ---------- HTML ----------
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --serif: 'Lora', Georgia, 'Times New Roman', serif; --sans: 'Inter', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
  html, body { background:#fff; }
  body { font-family: var(--sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .slide {
    position: relative; width: 1280px; height: 720px; overflow: hidden;
    page-break-after: always; break-after: page;
  }
  .slide:last-child { page-break-after: auto; }

  /* nav bar */
  .nav { display:flex; align-items:flex-end; height:74px; background:${C.nav};
         padding:0 18px; gap:-14px; }
  .navtab { font-family: var(--sans); font-size:19px; color:${C.navText};
            height:50px; display:flex; align-items:center; padding:0 30px;
            background:#e9e9e9; border-radius:18px 18px 0 0; margin-right:-10px;
            box-shadow: 0 -1px 0 rgba(0,0,0,.04); white-space:nowrap; }
  .navtab.active { height:58px; font-weight:500; }
  .navtab.spacer { flex:1; background:#fbfbfb; min-width:90px; padding:0; margin-right:0; }
  .navlogo { height:50px; display:flex; align-items:center; padding:0 26px 0 14px;
             background:#fbfbfb; border-radius:18px 18px 0 0; margin-right:-10px; }
  .navlogo svg { width:150px; height:auto; }

  .content { position:absolute; top:74px; left:0; right:0; bottom:0; padding:48px 56px; }

  /* title / thank-you */
  .titleblock { height:100%; display:flex; flex-direction:column; justify-content:center; padding:0 16px; }
  .titleblock h1 { font-family: var(--serif); font-weight:500; font-size:118px;
                   line-height:1.02; color:#111; letter-spacing:-1px; }
  .rule { height:2px; background:#111; margin-top:40px; width:100%; }
  .author { margin-top:26px; align-self:flex-end; font-size:30px; color:#1a1d24; }

  /* cards */
  .card { position:relative; border-radius:26px; padding:30px 30px 26px;
          box-shadow:0 1px 2px rgba(0,0,0,.04); }
  .card-tab { position:absolute; top:-20px; left:26px; width:120px; height:34px;
              border-radius:14px 14px 0 0; }
  .card h3 { font-family: var(--serif); font-weight:500; color:#15161a;
             font-size:32px; line-height:1.12; margin-bottom:18px; }
  .card .card-body p { font-size:18px; line-height:1.34; color:#1c1f26; margin-bottom:14px; }
  .card .card-body p:last-child { margin-bottom:0; }
  .card .sub { display:block; font-size:16px; color:#2a2d35; padding-left:6px; }

  .grid4 { display:grid; grid-template-columns:repeat(4,1fr); gap:22px; height:100%; padding-top:14px; }
  .grid2 { display:grid; grid-template-columns:repeat(2,1fr); gap:34px; height:100%; padding:30px 30px 0; }
  .grid2 .card h3 { font-size:38px; margin-bottom:24px; }
  .grid2 .card .card-body p { font-size:20px; line-height:1.4; margin-bottom:18px; }
  .grid8 { display:grid; grid-template-columns:repeat(4,1fr); grid-template-rows:1fr 1fr;
           gap:20px; height:100%; padding-top:14px; }
  .grid8 .card { padding:24px 22px 20px; }
  .grid8 .card h3 { font-size:27px; margin-bottom:14px; }
  .grid8 .card .card-body p { font-size:15.5px; line-height:1.3; margin-bottom:10px; }
  .grid1 { height:100%; padding-top:12px; }
  .grid1 .card.tall { height:100%; }
  .grid1 .card h3 { font-size:38px; margin-bottom:22px; }
  .grid1 .card .card-body p { font-size:21px; line-height:1.45; margin-bottom:16px; }

  /* media slide */
  .mediaslide { height:100%; display:flex; flex-direction:column; }
  .media-title { font-family:var(--serif); font-weight:500; font-size:34px; color:#15161a; margin-bottom:22px; }
  .media-grid { flex:1; display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:1fr 1fr; gap:22px; }
  .media-box { border:2px dashed rgba(40,40,60,.28); border-radius:16px;
               background:rgba(255,255,255,.35); display:flex; align-items:center; justify-content:center; }
  .media-box span { font-size:17px; color:rgba(40,40,60,.5); letter-spacing:.3px; }
</style></head>
<body>
${slides.join('\n')}
</body></html>`

const htmlPath = path.join(__dirname, 'week2.html')
writeFileSync(htmlPath, html)
console.log('Wrote', htmlPath)

// ---------- Render PDF ----------
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
const outPdf = '/home/hackoverflow/Downloads/06_12_2026 - Progress Presentation - Medhansh Garg.pdf'
await page.pdf({
  path: outPdf,
  width: '1280px',
  height: '720px',
  printBackground: true,
  pageRanges: '',
})
await browser.close()
console.log('Wrote', outPdf)
