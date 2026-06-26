/**
 * Flux browser automation - runs as a child process.
 * Drives HuggingFace FLUX.1-schnell (free, no account needed) to generate images.
 *
 * Reads JOB_ID, PROMPT, BROWSER_CONFIG_FILE from env.
 * Debug screenshots → storage/browser-debug/
 * Downloaded image  → storage/browser-images/
 */

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { writeJob } from './jobs'

const JOB_ID       = process.env.JOB_ID!
const PROMPT       = process.env.PROMPT!
const SESSION_FILE = process.env.BROWSER_SESSION_FILE ?? path.join(process.cwd(), '.browser-session-flux.json')
const CONFIG_FILE  = process.env.BROWSER_CONFIG_FILE  ?? path.join(process.cwd(), '.browser-config-flux.json')
const SCREENSHOT_DIR = path.join(process.cwd(), 'storage', 'browser-debug')
const IMAGE_DIR      = path.join(process.cwd(), 'storage', 'browser-images')
const HEADLESS = process.env.BROWSER_HEADLESS !== 'false'
const TIMEOUT  = Number(process.env.BROWSER_IMAGE_TIMEOUT_MS ?? 3 * 60 * 1000)

const DEFAULT_URL = 'https://elevenlabs.io/app/image-video?modality=image'

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
fs.mkdirSync(IMAGE_DIR,      { recursive: true })

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

interface FluxConfig {
  creationUrl?: string
  promptSelector?: string
  generateSelector?: string
}

async function run() {
  writeJob({ id: JOB_ID, prompt: PROMPT, status: 'processing', startedAt: Date.now() })

  // Load saved config if it exists, otherwise use defaults (HuggingFace Gradio standard selectors)
  let config: FluxConfig = {}
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  }

  const creationUrl    = config.creationUrl    ?? DEFAULT_URL
  const promptSelector = config.promptSelector ?? 'textarea'
  const generateSelector = config.generateSelector ?? 'button[class*="run"], button:has-text("Run"), button[type="submit"]'

  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Flux config not found. Run: npm run browser:setup:flux`)
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    viewport: { width: 1280, height: 800 },
  }
  if (fs.existsSync(SESSION_FILE)) {
    contextOptions.storageState = SESSION_FILE
  }
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()

  // Capture any image URLs from network
  const capturedImageUrls: string[] = []
  page.on('response', (response) => {
    const url = response.url()
    const ct  = response.headers()['content-type'] ?? ''
    // Capture any image response - ElevenLabs CDN URLs may not have .jpg/.webp in path
    if (!url.startsWith('blob:') && ct.startsWith('image/')) {
      capturedImageUrls.push(url)
      console.log(`[flux] Intercepted image [${ct}]: ${url.slice(0, 120)}`)
    }
  })

  try {
    // ── Step 1: Navigate (retry on transient network errors) ──
    let navError: Error | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(creationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        navError = null
        break
      } catch (err) {
        navError = err as Error
        console.log(`[flux] Navigation attempt ${attempt} failed: ${navError.message} - retrying...`)
        await page.waitForTimeout(3000)
      }
    }
    if (navError) throw new Error(`Navigation failed after 3 attempts: ${navError.message}`)
    await page.waitForTimeout(3000)
    await shot(page, '01-loaded')

    const currentUrl = page.url()
    if (currentUrl.includes('/login') || currentUrl.includes('/sign-in') || currentUrl.includes('auth')) {
      throw new Error('Session expired or not logged in. Run: npm run browser:setup:flux')
    }

    // ── Dismiss cookie/consent banners before interacting ──
    // Try clicking known button variants first (case-insensitive via regex)
    const dismissed = await page.evaluate(() => {
      const texts = ['accept all cookies', 'accept all', 'accept cookies', 'accept']
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
      for (const btn of buttons) {
        const text = (btn.textContent ?? '').trim().toLowerCase()
        if (texts.some(t => text === t || text.includes(t))) {
          (btn as HTMLElement).click()
          return (btn as HTMLElement).textContent?.trim() ?? 'clicked'
        }
      }
      return null
    })

    if (dismissed) {
      console.log(`[flux] Clicked consent button: "${dismissed}"`)
      await page.waitForTimeout(800)
    } else {
      // Fallback: remove known banner elements from DOM entirely
      await page.evaluate(() => {
        const selectors = ['#cookiebanner', '[id*="cookie-banner"]', '[class*="cookie-banner"]', '[id*="consent"]', '[class*="CookieConsent"]']
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => el.remove())
        }
      })
      await page.waitForTimeout(300)
    }
    await shot(page, '02-after-consent')

    // ── Step 2: Fill prompt ──
    const promptEl = page.locator(promptSelector).first()
    await promptEl.waitFor({ state: 'visible', timeout: 20000 })
    await promptEl.click()
    await promptEl.fill('')
    await promptEl.type(PROMPT.slice(0, 500), { delay: 10 })
    await shot(page, '02-prompt-filled')

    // ── Step 3: Click generate ──
    // Gradio's run button - try common selectors
    let generated = false
    for (const sel of [generateSelector, 'button.run-button', '#component-5 button', 'button:has-text("Run")', 'button[type="submit"]']) {
      const btn = page.locator(sel).first()
      if (await btn.count() > 0 && await btn.isVisible()) {
        await btn.click()
        generated = true
        break
      }
    }
    if (!generated) {
      await shot(page, 'error-no-generate-btn')
      throw new Error(`Could not find generate button. Check ${SCREENSHOT_DIR} screenshots. Run: npm run browser:setup:flux`)
    }
    await shot(page, '03-submitted')

    // Flush network captures - promo banners, gallery thumbnails captured before submit
    capturedImageUrls.length = 0

    // ElevenLabs navigates to History tab after submit - give it time to land
    await page.waitForTimeout(5000)
    await shot(page, '03b-history-tab')

    // Dismiss any "GPT Image 2 just launched" or similar promo popups that block the UI
    const popupClosed = await page.evaluate(() => {
      const closeSelectors = ['[class*="modal"] button', '[aria-label="Close"]', '[aria-label="Dismiss"]', 'button[class*="close"]']
      for (const sel of closeSelectors) {
        const el = document.querySelector(sel)
        if (el && (el as HTMLElement).offsetParent !== null) {
          (el as HTMLElement).click()
          return true
        }
      }
      // Also try clicking the ✕ inside any visible overlay
      const overlays = document.querySelectorAll('[class*="popup"], [class*="modal"], [class*="overlay"]')
      for (const o of Array.from(overlays)) {
        const x = (o as HTMLElement).querySelector('button')
        if (x) { x.click(); return true }
      }
      return false
    })
    if (popupClosed) {
      console.log('[flux] Dismissed popup')
      await page.waitForTimeout(600)
    }

    // Flush again - the popup may have triggered more image loads
    capturedImageUrls.length = 0

    // ── Step 4: Wait for "X% done" to clear, then capture the image ──
    const startedAt = Date.now()
    let imageUrl: string | null = null
    let generationComplete = false

    console.log(`[flux] Watching for generation to complete...`)

    while (Date.now() - startedAt < TIMEOUT) {
      await page.waitForTimeout(5000)
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      await shot(page, `04-poll-${elapsed}s`)

      // Check if "X% done" text is still visible - if yes, still generating
      const progressText = await page.evaluate(() => document.body.innerText.match(/\d+%\s*done/i)?.[0] ?? null)
      if (progressText) {
        console.log(`[flux] ${progressText} - still generating, waiting...`)
        capturedImageUrls.length = 0 // flush again during wait
        continue
      }

      // No progress text - generation done. Now wait for all images to fully load.
      if (!generationComplete) {
        generationComplete = true
        console.log('[flux] Generation complete - waiting for all images to load...')
        capturedImageUrls.length = 0  // flush everything before the final load

        // ElevenLabs loads all images shortly after progress clears - give it time
        await page.waitForTimeout(8000)
      }

      // Collect unique CDN image URLs - filter out small placeholder/skeleton images
      // Real ElevenLabs images come from CDN (long URLs, large files)
      // Placeholder skeletons are CSS gradients (not network requests) or tiny files
      const unique = [...new Set(capturedImageUrls)].filter(url =>
        url.length > 60 &&
        !url.includes('icon') &&
        !url.includes('logo') &&
        !url.includes('avatar') &&
        !url.includes('favicon') &&
        !url.includes('placeholder')
      )

      if (unique.length >= 1) {
        // Prefer the last N URLs (most recently loaded = the generated images, not gallery)
        const candidates = unique.slice(-4)
        imageUrl = candidates[0] // primary
        console.log(`[flux] Captured ${candidates.length} image URL(s)`)
        candidates.forEach((u, i) => console.log(`  [${i + 1}] ${u.slice(0, 100)}`))

        // Store all URLs in the job for multi-image creation
        writeJob({
          id: JOB_ID, prompt: PROMPT, status: 'complete',
          fileUrl: `/api/browser-images/${JOB_ID}-0.webp`,
          fileUrls: candidates.map((_, i) => `/api/browser-images/${JOB_ID}-${i}.webp`),
          startedAt: Date.now(),
        })

        // Download all images
        const IMAGE_DIR_INNER = path.join(process.cwd(), 'storage', 'browser-images')
        for (let i = 0; i < candidates.length; i++) {
          const url = candidates[i]
          const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg'
          const destPath = path.join(IMAGE_DIR_INNER, `${JOB_ID}-${i}.${ext}`)

          if (url.startsWith('blob:') || url.startsWith('data:')) {
            const base64 = await page.evaluate(async (u) => {
              const blob = await fetch(u).then(r => r.blob())
              return new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve((reader.result as string).split(',')[1])
                reader.onerror = () => reject(new Error('FileReader failed'))
                reader.readAsDataURL(blob)
              })
            }, url)
            fs.writeFileSync(destPath, Buffer.from(base64, 'base64'))
          } else {
            await downloadFile(url, destPath)
          }

          // Update fileUrls with correct extension
          const fileUrls = candidates.map((_, j) => `/api/browser-images/${JOB_ID}-${j}.${ext}`)
          writeJob({
            id: JOB_ID, prompt: PROMPT, status: 'complete',
            fileUrl: fileUrls[0],
            fileUrls,
            startedAt: Date.now(),
          })
        }

        await shot(page, '05-done')
        console.log(`[flux] Job ${JOB_ID} complete - ${candidates.length} image(s) downloaded`)
        return  // exit the run() function - already wrote job file
      }

      // Keep waiting - no images captured yet after generation completed
    }

    if (!imageUrl) {
      await shot(page, 'error-timeout')
      throw new Error(`Timed out after ${TIMEOUT / 1000}s. Check screenshots in storage/browser-debug/`)
    }

  } catch (err) {
    console.error(`[flux] Job ${JOB_ID} failed:`, err)
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
