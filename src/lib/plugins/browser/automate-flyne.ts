/**
 * Flyne.ai browser automation — runs as a child process.
 * Drives https://flyne.ai to generate images.
 *
 * Reads JOB_ID, PROMPT, BROWSER_SESSION_FILE, BROWSER_CONFIG_FILE from env.
 * Debug screenshots → storage/browser-debug/
 * Downloaded images  → storage/browser-images/
 */

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { writeJob } from './jobs'

const JOB_ID       = process.env.JOB_ID!
const PROMPT       = process.env.PROMPT!
const SESSION_FILE = process.env.BROWSER_SESSION_FILE ?? path.join(process.cwd(), '.browser-session-flyne.json')
const CONFIG_FILE  = process.env.BROWSER_CONFIG_FILE  ?? path.join(process.cwd(), '.browser-config-flyne.json')
const SCREENSHOT_DIR = path.join(process.cwd(), 'storage', 'browser-debug')
const IMAGE_DIR      = path.join(process.cwd(), 'storage', 'browser-images')
const HEADLESS = process.env.BROWSER_HEADLESS !== 'false'
const TIMEOUT  = Number(process.env.BROWSER_IMAGE_TIMEOUT_MS ?? 5 * 60 * 1000)

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

interface FlyneConfig {
  creationUrl: string
  promptSelector: string
  generateSelector: string
  modelSelectionSteps?: Array<{ selector: string; text: string }>
}

async function run() {
  writeJob({ id: JOB_ID, prompt: PROMPT, status: 'processing', startedAt: Date.now() })

  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Flyne config not found. Run: npm run browser:setup:flyne`)
  }
  const config: FlyneConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  console.log(`[flyne] url=${config.creationUrl} prompt="${config.promptSelector}" btn="${config.generateSelector}"`)

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  // Capture all image responses after generation starts
  const capturedImageUrls: string[] = []
  page.on('response', (response) => {
    const url = response.url()
    const ct  = response.headers()['content-type'] ?? ''
    if (!url.startsWith('blob:') && ct.startsWith('image/')) {
      capturedImageUrls.push(url)
      console.log(`[flyne] Intercepted [${ct}]: ${url.slice(0, 100)}`)
    }
  })

  try {
    // ── Step 1: Navigate (with retries) ──
    let navError: Error | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(config.creationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        navError = null
        break
      } catch (err) {
        navError = err as Error
        console.log(`[flyne] Nav attempt ${attempt} failed — retrying...`)
        await page.waitForTimeout(3000)
      }
    }
    if (navError) throw new Error(`Navigation failed: ${navError.message}`)
    await page.waitForTimeout(3000)
    await shot(page, '01-loaded')

    // Detect logged-out state
    const currentUrl = page.url()
    if (currentUrl.includes('/login') || currentUrl.includes('/sign-in') || currentUrl.includes('/auth')) {
      throw new Error('Session expired. Run: npm run browser:setup:flyne')
    }

    // Sanity check: verify we are on a generation page, not the homepage
    // The homepage has tool-listing cards; the generator page has a prompt input
    const hasPromptInput = await page.locator(config.promptSelector).count() > 0
    if (!hasPromptInput) {
      await shot(page, 'error-wrong-page')
      throw new Error(
        `Not on the image generation page. Current URL: ${currentUrl}\n` +
        `The saved creationUrl may be the homepage rather than the specific generator page.\n` +
        `Run: npm run browser:setup:flyne — at Step 2, navigate TO the AI Image Generator ` +
        `(e.g. https://flyne.ai/ai-image-generator), select your model, then press Enter.`
      )
    }

    // ── Dismiss cookie/consent banners ──
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
      console.log(`[flyne] Dismissed consent: "${dismissed}"`)
      await page.waitForTimeout(800)
    } else {
      await page.evaluate(() => {
        ['#cookiebanner', '[id*="cookie-banner"]', '[id*="consent"]'].forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove())
        })
      })
    }
    await shot(page, '02-after-consent')

    // ── Replay model selection steps (if recorded during setup) ──
    if (config.modelSelectionSteps && config.modelSelectionSteps.length > 0) {
      console.log(`[flyne] Replaying ${config.modelSelectionSteps.length} model selection step(s)...`)

      // Dismiss any sidebar/overlay that may intercept clicks
      await page.evaluate(() => {
        // Hide sidebars that intercept pointer events
        const sidebars = document.querySelectorAll('[class*="sidebar"], [class*="side-bar"], aside')
        sidebars.forEach(el => {
          const h = el as HTMLElement
          if (h.style) h.style.pointerEvents = 'none'
        })
      })

      for (const step of config.modelSelectionSteps) {
        const el = page.locator(step.selector).first()
        if (await el.count() > 0) {
          // Try normal click first, fall back to JS click which bypasses overlay interception
          try {
            await el.click({ timeout: 5000 })
          } catch {
            await el.evaluate(node => (node as HTMLElement).click())
          }
          await page.waitForTimeout(1000)
          console.log(`[flyne] Clicked: ${step.selector} "${step.text}"`)
        } else {
          console.log(`[flyne] Warning: step element not found: ${step.selector} "${step.text}"`)
        }
      }

      // Restore pointer events
      await page.evaluate(() => {
        document.querySelectorAll('[class*="sidebar"], [class*="side-bar"], aside').forEach(el => {
          (el as HTMLElement).style.pointerEvents = ''
        })
      })

      await page.waitForTimeout(1000)
      await shot(page, '02b-after-model-selection')
    }

    // ── Step 2: Fill prompt ──
    const promptEl = page.locator(config.promptSelector).first()
    await promptEl.waitFor({ state: 'visible', timeout: 20000 })
    await promptEl.click()
    await promptEl.fill('')
    await promptEl.type(PROMPT.slice(0, 800), { delay: 15 })
    await shot(page, '03-prompt-filled')

    // ── Step 3: Click generate ──
    const generateBtn = page.locator(config.generateSelector).first()
    await generateBtn.waitFor({ state: 'visible', timeout: 10000 })
    try {
      await generateBtn.click({ timeout: 8000 })
    } catch {
      // Sidebar may intercept — use JS click to bypass
      await generateBtn.evaluate(node => (node as HTMLElement).click())
    }
    await shot(page, '04-submitted')

    // Flush pre-generation network captures
    capturedImageUrls.length = 0
    await page.waitForTimeout(5000)
    await shot(page, '04b-after-submit')

    // Dismiss any promo popups that appeared
    await page.evaluate(() => {
      const closeSelectors = ['[class*="modal"] button', '[aria-label="Close"]', '[aria-label="Dismiss"]']
      for (const sel of closeSelectors) {
        const el = document.querySelector(sel)
        if (el && (el as HTMLElement).offsetParent !== null) {
          (el as HTMLElement).click()
        }
      }
    })
    await page.waitForTimeout(500)
    capturedImageUrls.length = 0

    // ── Step 4: Wait for generation to complete ──
    const startedAt = Date.now()
    let generationComplete = false

    console.log(`[flyne] Waiting for generation to complete...`)

    while (Date.now() - startedAt < TIMEOUT) {
      await page.waitForTimeout(5000)
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      await shot(page, `05-poll-${elapsed}s`)

      // Check for progress indicators (spinner, % text, loading class)
      const isGenerating = await page.evaluate(() => {
        const bodyText = document.body.innerText
        if (bodyText.match(/\d+%\s*(done|complete|loading|generating)/i)) return true
        if (document.querySelector('[class*="loading"], [class*="spinner"], [class*="generating"], [aria-busy="true"]')) return true
        return false
      })

      if (isGenerating) {
        console.log(`[flyne] Still generating at ${elapsed}s...`)
        capturedImageUrls.length = 0
        continue
      }

      // Looks done — wait for images to fully load
      if (!generationComplete) {
        generationComplete = true
        console.log('[flyne] Generation appears complete — waiting for images to load...')
        capturedImageUrls.length = 0
        await page.waitForTimeout(6000)
      }

      // Flyne-specific: look for images in the Collections/History panel on the right
      // These appear as <img> elements with CDN URLs after generation completes
      const flyneImages = await page.evaluate(() => {
        const found: string[] = []

        // Look in collections / history / result panels
        const panels = document.querySelectorAll(
          '[class*="collection"], [class*="history"], [class*="result"], [class*="output"], [class*="gallery"]'
        )
        for (const panel of Array.from(panels)) {
          for (const img of Array.from(panel.querySelectorAll('img[src]'))) {
            const src = (img as HTMLImageElement).src
            if (src && src.startsWith('http') && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')) {
              found.push(src)
            }
          }
        }

        // Also look for download anchor links pointing to CDN images
        for (const a of Array.from(document.querySelectorAll('a[href*="cdn"], a[href*="storage"], a[download]'))) {
          const href = (a as HTMLAnchorElement).href
          if (href && href.startsWith('http')) found.push(href)
        }

        return [...new Set(found)]
      })

      if (flyneImages.length > 0) {
        console.log(`[flyne] Found ${flyneImages.length} image(s) in Collections panel`)
        flyneImages.forEach((u, i) => console.log(`  [${i + 1}] ${u.slice(0, 100)}`))
        // Use the DOM-found images as candidates
        capturedImageUrls.push(...flyneImages)
      }

      // Collect real image URLs (filter out icons/placeholders)
      const unique = [...new Set(capturedImageUrls)].filter(url =>
        url.length > 60 &&
        !url.includes('icon') &&
        !url.includes('logo') &&
        !url.includes('avatar') &&
        !url.includes('favicon') &&
        !url.includes('placeholder') &&
        !url.includes('photo_to_video') &&  // Flyne's sidebar preview images
        !url.includes('home/')              // Flyne's homepage asset images
      )

      if (unique.length >= 1) {
        const candidates = unique.slice(-4) // take most recent, up to 4
        console.log(`[flyne] Captured ${candidates.length} image URL(s)`)
        candidates.forEach((u, i) => console.log(`  [${i + 1}] ${u.slice(0, 100)}`))

        // Download all images
        const ext = candidates[0].includes('.png') ? 'png' : candidates[0].includes('.webp') ? 'webp' : 'jpg'
        const fileUrls: string[] = []

        for (let i = 0; i < candidates.length; i++) {
          const url = candidates[i]
          const destPath = path.join(IMAGE_DIR, `${JOB_ID}-${i}.${ext}`)

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
          fileUrls.push(`/api/browser-images/${JOB_ID}-${i}.${ext}`)
        }

        writeJob({
          id: JOB_ID, prompt: PROMPT, status: 'complete',
          fileUrl: fileUrls[0],
          fileUrls,
          startedAt: Date.now(),
        })
        await shot(page, '06-done')
        console.log(`[flyne] Job ${JOB_ID} complete — ${candidates.length} image(s)`)
        return
      }
    }

    await shot(page, 'error-timeout')
    throw new Error(`Timed out after ${TIMEOUT / 1000}s. Check screenshots in storage/browser-debug/`)

  } catch (err) {
    console.error(`[flyne] Job ${JOB_ID} failed:`, err)
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
