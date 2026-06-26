/**
 * Kling AI web automation - runs as a child process.
 * Reads JOB_ID and PROMPT from env, opens kling.ai with the saved session,
 * navigates to the video creation page, submits the prompt, waits for the
 * video to appear, downloads it, and writes the result to the job file.
 *
 * Debug screenshots are written to storage/browser-debug/ at each step.
 */

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { writeJob, readJob } from './jobs'

const JOB_ID      = process.env.JOB_ID!
const PROMPT      = process.env.PROMPT!
const SESSION_FILE = process.env.BROWSER_SESSION_FILE ?? path.join(process.cwd(), '.browser-session-kling.json')
const CONFIG_FILE  = process.env.BROWSER_CONFIG_FILE  ?? path.join(process.cwd(), '.browser-config-kling.json')
const SCREENSHOT_DIR = path.join(process.cwd(), 'storage', 'browser-debug')
const VIDEO_DIR      = path.join(process.cwd(), 'storage', 'browser-videos')
const HEADLESS = process.env.BROWSER_HEADLESS !== 'false'
const TIMEOUT  = Number(process.env.BROWSER_VIDEO_TIMEOUT_MS ?? 5 * 60 * 1000)

interface BrowserConfig {
  creationUrl: string
  promptSelector: string
  generateSelector: string
}

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
fs.mkdirSync(VIDEO_DIR,      { recursive: true })

async function shot(page: import('playwright').Page, name: string) {
  try { await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${JOB_ID}-${name}.png`) }) }
  catch { /* non-fatal */ }
}

async function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); return download(res.headers.location!, dest).then(resolve).catch(reject)
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', (e) => { fs.unlink(dest, () => {}); reject(e) })
  })
}

async function run() {
  writeJob({ id: JOB_ID, prompt: PROMPT, status: 'processing', startedAt: Date.now() })

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  // Intercept network responses to capture the real CDN video URL
  // (Kling loads the video from CDN first, then wraps it in a blob URL)
  const capturedVideoUrls: string[] = []
  page.on('response', (response) => {
    const url = response.url()
    const ct = response.headers()['content-type'] ?? ''
    if (
      !url.startsWith('blob:') &&
      (ct.startsWith('video/') || url.includes('.mp4') || url.includes('/video/'))
    ) {
      capturedVideoUrls.push(url)
      console.log(`[kling] Captured CDN video URL: ${url}`)
    }
  })

  try {
    // ── Load saved UI config from browser:setup ──
    if (!fs.existsSync(CONFIG_FILE)) {
      throw new Error(
        'No browser config found. Run: npm run browser:setup\n' +
        'This records exactly which elements to click for prompts and generation.'
      )
    }
    const config: BrowserConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    console.log(`[kling] Using config: url=${config.creationUrl} prompt="${config.promptSelector}" btn="${config.generateSelector}"`)

    // ── Step 1: Navigate to the saved creation URL ──
    // If Kling opens creation in a new tab during normal use, direct navigation
    // to the saved URL should still work - it's just a URL.
    await page.goto(config.creationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)
    await shot(page, '01-creation-page')

    // Detect logged-out by URL only
    const currentUrl = page.url()
    if (currentUrl.includes('sign-in') || currentUrl.includes('/login') || currentUrl.includes('/register')) {
      throw new Error('Session expired. Run: npm run browser:setup to log in again.')
    }

    // If the page redirected away from creation URL, try going via dashboard first
    if (!page.url().includes(config.creationUrl.replace('https://kling.ai', ''))) {
      console.log('[kling] Direct URL redirect detected - navigating via dashboard')
      await page.goto('https://kling.ai/app', { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForTimeout(2000)
      // Open the creation URL in the same tab
      await page.goto(config.creationUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForTimeout(3000)
    }

    await shot(page, '02-loaded')

    // ── Step 2: Fill in the prompt using the saved selector ──
    const promptEl = page.locator(config.promptSelector).first()
    await promptEl.waitFor({ state: 'visible', timeout: 20000 })
    await promptEl.click()
    await promptEl.fill('')
    await promptEl.type(PROMPT.slice(0, 500), { delay: 20 })
    await shot(page, '03-prompt-filled')

    // ── Step 3: Click the generate button ──
    const generateBtn = page.locator(config.generateSelector).first()
    await generateBtn.waitFor({ state: 'visible', timeout: 10000 })
    await generateBtn.click()
    await shot(page, '04-submitted')

    // ── Step 5: Wait for the video to finish generating ──
    const startedAt = Date.now()
    let videoUrl: string | null = null

    console.log(`[kling] Waiting up to ${TIMEOUT / 1000}s for video generation...`)

    while (Date.now() - startedAt < TIMEOUT) {
      await page.waitForTimeout(8000)
      const elapsed = Math.round((Date.now() - startedAt) / 1000)

      // Dismiss any popups / modals that appear (free credits upsell, notifications, etc.)
      for (const closeBtn of [
        page.locator('button').filter({ hasText: /^(×|✕|close|dismiss|maybe later|no thanks)/i }).first(),
        page.locator('[aria-label="Close"], [aria-label="close"]').first(),
        page.locator('.modal-close, .popup-close, .dialog-close').first(),
      ]) {
        if (await closeBtn.count() > 0 && await closeBtn.isVisible()) {
          await closeBtn.click().catch(() => {})
          await page.waitForTimeout(500)
        }
      }

      await shot(page, `06-poll-${elapsed}s`)

      // Priority 1: CDN URL captured by network interception
      if (capturedVideoUrls.length > 0) {
        videoUrl = capturedVideoUrls[capturedVideoUrls.length - 1]
        console.log(`[kling] Using intercepted CDN URL: ${videoUrl}`)
        break
      }

      // Priority 2: <video src="https://..."> (non-blob CDN src on the element)
      const cdnVideo = await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'))
        for (const v of videos) {
          if (v.src && !v.src.startsWith('blob:') && v.src.startsWith('http')) return v.src
          const src = v.querySelector('source')?.src
          if (src && !src.startsWith('blob:') && src.startsWith('http')) return src
        }
        return null
      })
      if (cdnVideo) { videoUrl = cdnVideo; break }

      // Priority 3: Download/export button href
      const dlHref = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'))
        for (const a of links) {
          const href = (a as HTMLAnchorElement).href
          if (href && href.startsWith('http') && (href.includes('.mp4') || a.getAttribute('download') !== null)) return href
        }
        return null
      })
      if (dlHref) { videoUrl = dlHref; break }

      // Priority 4: Blob URL - we can download these from inside the browser
      const blobUrl = await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'))
        for (const v of videos) {
          if (v.src?.startsWith('blob:')) return v.src
          const src = v.querySelector('source')?.src
          if (src?.startsWith('blob:')) return src
        }
        return null
      })
      if (blobUrl) {
        videoUrl = blobUrl
        console.log('[kling] Found blob URL - will download via browser context')
        break
      }
    }

    if (!videoUrl) {
      await shot(page, 'error-timeout')
      throw new Error(`Timed out after ${TIMEOUT / 1000}s. Check screenshots to see what Kling showed.`)
    }

    // ── Step 6: Download and save the video ──
    const destPath = path.join(VIDEO_DIR, `${JOB_ID}.mp4`)

    if (videoUrl.startsWith('blob:')) {
      // Download blob from inside the browser - Node's http module can't handle blob: URLs
      console.log('[kling] Downloading blob URL via browser evaluate...')
      const base64 = await page.evaluate(async (url) => {
        const response = await fetch(url)
        const blob = await response.blob()
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = () => reject(new Error('FileReader failed'))
          reader.readAsDataURL(blob)
        })
      }, videoUrl)
      fs.writeFileSync(destPath, Buffer.from(base64, 'base64'))
    } else {
      await download(videoUrl, destPath)
    }

    writeJob({
      id: JOB_ID, prompt: PROMPT, status: 'complete',
      fileUrl: `/api/browser-videos/${JOB_ID}.mp4`,
      startedAt: Date.now(),
    })
    await shot(page, '07-done')
    console.log(`[kling] Job ${JOB_ID} complete`)

  } catch (err) {
    console.error(`[kling] Job ${JOB_ID} failed:`, err)
    await shot(page, 'error')
    writeJob({ id: JOB_ID, prompt: PROMPT, status: 'failed', error: String(err), startedAt: Date.now() })
  } finally {
    await browser.close()
  }
}

run().catch((err) => {
  writeJob({ id: JOB_ID, prompt: PROMPT, status: 'failed', error: String(err), startedAt: Date.now() })
  process.exit(1)
})
