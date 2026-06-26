/**
 * Google Veo 3 web automation - runs as a child process.
 * Drives Google AI Studio (aistudio.google.com) to generate videos with Veo 3.
 *
 * Reads JOB_ID, PROMPT, BROWSER_SESSION_FILE, BROWSER_CONFIG_FILE from env.
 * Debug screenshots → storage/browser-debug/
 * Downloaded video → storage/browser-videos/
 */

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { writeJob } from './jobs'

const JOB_ID      = process.env.JOB_ID!
const PROMPT      = process.env.PROMPT!
const SESSION_FILE = process.env.BROWSER_SESSION_FILE ?? path.join(process.cwd(), '.browser-session-veo.json')
const CONFIG_FILE  = process.env.BROWSER_CONFIG_FILE  ?? path.join(process.cwd(), '.browser-config-veo.json')
const SCREENSHOT_DIR = path.join(process.cwd(), 'storage', 'browser-debug')
const VIDEO_DIR      = path.join(process.cwd(), 'storage', 'browser-videos')
const HEADLESS = process.env.BROWSER_HEADLESS !== 'false'
const TIMEOUT  = Number(process.env.BROWSER_VIDEO_TIMEOUT_MS ?? 10 * 60 * 1000) // Veo can be slower

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
fs.mkdirSync(VIDEO_DIR,      { recursive: true })

async function shot(page: import('playwright').Page, name: string) {
  try { await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${JOB_ID}-${name}.png`) }) }
  catch { /* non-fatal */ }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); return downloadFile(res.headers.location!, dest).then(resolve).catch(reject)
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', (e) => { fs.unlink(dest, () => {}); reject(e) })
  })
}

interface VeoConfig {
  creationUrl: string
  promptSelector: string
  generateSelector: string
}

async function run() {
  writeJob({ id: JOB_ID, prompt: PROMPT, status: 'processing', startedAt: Date.now() })

  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Veo config not found at ${CONFIG_FILE}. Run: npm run browser:setup:veo`)
  }
  const config: VeoConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  console.log(`[veo] Config: url=${config.creationUrl} prompt="${config.promptSelector}" btn="${config.generateSelector}"`)

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  // Intercept CDN video responses before they become blob URLs
  const capturedVideoUrls: string[] = []
  page.on('response', (response) => {
    const url = response.url()
    const ct  = response.headers()['content-type'] ?? ''
    if (!url.startsWith('blob:') && (ct.startsWith('video/') || url.includes('.mp4'))) {
      capturedVideoUrls.push(url)
      console.log(`[veo] Captured video URL: ${url}`)
    }
  })

  try {
    // ── Step 1: Navigate to the saved creation URL ──
    await page.goto(config.creationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)
    await shot(page, '01-loaded')

    const currentUrl = page.url()
    if (currentUrl.includes('sign-in') || currentUrl.includes('accounts.google.com') || currentUrl.includes('/auth')) {
      throw new Error('Veo session expired. Run: npm run browser:setup:veo to log in again.')
    }

    // ── Step 2: Fill prompt ──
    const promptEl = page.locator(config.promptSelector).first()
    await promptEl.waitFor({ state: 'visible', timeout: 20000 })
    await promptEl.click()
    await promptEl.fill('')
    await promptEl.type(PROMPT.slice(0, 800), { delay: 15 })
    await shot(page, '02-prompt-filled')

    // ── Step 3: Submit generation ──
    const generateBtn = page.locator(config.generateSelector).first()
    await generateBtn.waitFor({ state: 'visible', timeout: 10000 })
    await generateBtn.click()
    await shot(page, '03-submitted')

    // ── Step 4: Poll for the completed video ──
    const startedAt = Date.now()
    let videoUrl: string | null = null

    console.log(`[veo] Polling for up to ${TIMEOUT / 1000}s...`)

    while (Date.now() - startedAt < TIMEOUT) {
      await page.waitForTimeout(10000)
      const elapsed = Math.round((Date.now() - startedAt) / 1000)

      // Dismiss any popups
      for (const sel of ['button[aria-label="Close"]', '[data-testid="close-button"]', 'button:has-text("Got it")', 'button:has-text("Dismiss")']) {
        const el = page.locator(sel).first()
        if (await el.count() > 0 && await el.isVisible()) await el.click().catch(() => {})
      }

      await shot(page, `04-poll-${elapsed}s`)

      // Priority 1: Network-intercepted CDN URL
      if (capturedVideoUrls.length > 0) {
        videoUrl = capturedVideoUrls[capturedVideoUrls.length - 1]
        break
      }

      // Priority 2: Non-blob <video> src
      const cdnVideo = await page.evaluate(() => {
        for (const v of Array.from(document.querySelectorAll('video'))) {
          if (v.src && v.src.startsWith('http')) return v.src
          const s = v.querySelector('source')?.src
          if (s && s.startsWith('http')) return s
        }
        return null
      })
      if (cdnVideo) { videoUrl = cdnVideo; break }

      // Priority 3: Download button/link
      const dlHref = await page.evaluate(() => {
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const href = (a as HTMLAnchorElement).href
          if (href.startsWith('http') && (href.includes('.mp4') || a.getAttribute('download') !== null)) return href
        }
        return null
      })
      if (dlHref) { videoUrl = dlHref; break }

      // Priority 4: Blob URL (downloadable via page.evaluate)
      const blobUrl = await page.evaluate(() => {
        for (const v of Array.from(document.querySelectorAll('video'))) {
          if (v.src?.startsWith('blob:')) return v.src
          const s = v.querySelector('source')?.src
          if (s?.startsWith('blob:')) return s
        }
        return null
      })
      if (blobUrl) { videoUrl = blobUrl; break }
    }

    if (!videoUrl) {
      await shot(page, 'error-timeout')
      throw new Error(`Timed out after ${TIMEOUT / 1000}s. Check screenshots.`)
    }

    // ── Step 5: Download and save ──
    const destPath = path.join(VIDEO_DIR, `${JOB_ID}.mp4`)

    if (videoUrl.startsWith('blob:')) {
      console.log('[veo] Downloading blob via browser evaluate...')
      const base64 = await page.evaluate(async (url) => {
        const blob = await fetch(url).then(r => r.blob())
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = () => reject(new Error('FileReader failed'))
          reader.readAsDataURL(blob)
        })
      }, videoUrl)
      fs.writeFileSync(destPath, Buffer.from(base64, 'base64'))
    } else {
      await downloadFile(videoUrl, destPath)
    }

    writeJob({ id: JOB_ID, prompt: PROMPT, status: 'complete', fileUrl: `/api/browser-videos/${JOB_ID}.mp4`, startedAt: Date.now() })
    await shot(page, '05-done')
    console.log(`[veo] Job ${JOB_ID} complete`)

  } catch (err) {
    console.error(`[veo] Job ${JOB_ID} failed:`, err)
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
