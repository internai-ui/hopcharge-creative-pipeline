/**
 * One-time browser session setup for ElevenLabs image generation (Flux).
 *
 * Saves two things:
 *   .browser-session-flux.json  — cookies / login state
 *   .browser-config-flux.json   — exact selectors for prompt + generate button
 *
 * Run: npm run browser:setup:flux
 * Target: https://elevenlabs.io/app/image-video?modality=image
 */

import { chromium, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import readline from 'readline'

const SESSION_FILE = path.join(process.cwd(), '.browser-session-flux.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config-flux.json')
const TARGET_URL   = 'https://elevenlabs.io/app/image-video?modality=image'

function ask(question: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, () => { rl.close(); resolve() })
  })
}

async function captureNextClick(page: Page): Promise<Record<string, string>> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__capturedEl = null
    document.addEventListener('click', (e) => {
      // Walk up the DOM to find the best identifiable ancestor —
      // clicking inside a contenteditable lands on a <p> with no useful attrs
      let el = e.target as HTMLElement
      let best = el
      for (let i = 0; i < 6; i++) {
        if (
          el.id ||
          el.getAttribute('data-testid') ||
          el.getAttribute('aria-label') ||
          el.getAttribute('contenteditable') === 'true' ||
          el.tagName === 'BUTTON' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'INPUT'
        ) {
          best = el
          break
        }
        if (!el.parentElement) break
        el = el.parentElement
      }
      ;(window as unknown as Record<string, unknown>).__capturedEl = {
        tagName:         best.tagName.toLowerCase(),
        id:              best.id || '',
        placeholder:     (best as HTMLInputElement).placeholder || '',
        ariaLabel:       best.getAttribute('aria-label') || '',
        dataTestId:      best.getAttribute('data-testid') || '',
        name:            (best as HTMLInputElement).name || '',
        className:       best.getAttribute('class') || '',
        contenteditable: best.getAttribute('contenteditable') || '',
        role:            best.getAttribute('role') || '',
        text:            best.textContent?.trim().slice(0, 80) || '',
      }
    }, { once: true, capture: true })
  })
  await ask('   → Click the element, then press Enter... ')
  const info = await page.evaluate(() => (window as unknown as Record<string, unknown>).__capturedEl) as Record<string, string>
  if (!info) throw new Error('No element captured — click before pressing Enter.')
  return info
}

function buildSelector(info: Record<string, string>): string {
  if (info.id)                           return `#${info.id}`
  if (info.dataTestId)                   return `[data-testid=${info.dataTestId}]`
  if (info.ariaLabel)                    return `[aria-label=${info.ariaLabel}]`
  if (info.placeholder)                  return `[placeholder=${info.placeholder}]`
  if (info.name)                         return `${info.tagName}[name=${info.name}]`
  if (info.role)                         return `[role=${info.role}]`
  if (info.contenteditable === 'true')   return '[contenteditable="true"]'
  // Skip Tailwind dynamic classes that contain CSS special characters
  const stableClass = info.className?.split(' ').find(c => c && !/\d{4,}/.test(c) && !/[:\[\]()#.+~>^|]/.test(c))
  if (stableClass)                       return `${info.tagName}.${stableClass}`
  return info.tagName
}

async function main() {
  console.log('\n=== ElevenLabs Flux image setup ===\n')
  console.log('Target: https://elevenlabs.io/app/image-video?modality=image\n')

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] })
  const context = await browser.newContext({ viewport: null })

  context.on('page', (p) => p.on('load', () => console.log(`  [tab] ${p.url()}`)))

  const page = await context.newPage()
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' })

  // ── Step 1: Log in ──────────────────────────────────────────────────────────
  console.log('Step 1: Log in to ElevenLabs')
  console.log('  Use Google or email. Popups will open automatically.')
  await ask('  Press Enter once you are logged in and can see the image generation page... ')

  // Use the most recently active page (handles any new tabs from login)
  const activePage = () => { const all = context.pages(); return all[all.length - 1] }
  let creationPage = activePage()

  // Make sure we are on the image generation page
  if (!creationPage.url().includes('image-video')) {
    await creationPage.goto(TARGET_URL, { waitUntil: 'domcontentloaded' })
    await creationPage.waitForTimeout(2000)
    creationPage = activePage()
  }

  const creationUrl = creationPage.url()
  console.log(`  ✓ Creation URL: ${creationUrl}`)

  // ── Step 2: Capture the prompt input ───────────────────────────────────────
  console.log('\nStep 2: Click the prompt text input')
  console.log('  Click on the box where you type the image description.')
  const promptInfo = await captureNextClick(creationPage)
  const promptSelector = buildSelector(promptInfo)
  console.log(`  ✓ Prompt: <${promptInfo.tagName}> selector="${promptSelector}"`)
  if (promptInfo.placeholder) console.log(`    placeholder="${promptInfo.placeholder}"`)

  // ── Step 3: Capture the generate button ────────────────────────────────────
  console.log('\nStep 3: Click the Generate button')
  console.log('  Click the button that starts image generation.')
  const generateInfo = await captureNextClick(creationPage)
  const generateSelector = buildSelector(generateInfo)
  console.log(`  ✓ Generate: <${generateInfo.tagName}> selector="${generateSelector}" text="${generateInfo.text}"`)

  // ── Save ───────────────────────────────────────────────────────────────────
  await context.storageState({ path: SESSION_FILE })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(
    { creationUrl, promptSelector, promptInfo, generateSelector, generateInfo },
    null, 2
  ))

  await browser.close()

  console.log(`\n✓ Session saved → ${SESSION_FILE}`)
  console.log(`✓ Config saved  → ${CONFIG_FILE}`)
  console.log('\nTo activate: set IMAGE_GENERATOR=browser-flux in .env.local and restart.\n')
}

main().catch((err) => { console.error('Setup failed:', err); process.exit(1) })
