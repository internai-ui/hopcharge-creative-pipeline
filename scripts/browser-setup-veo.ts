/**
 * One-time browser session setup for Google Veo 3 via AI Studio.
 *
 * Saves two things:
 *   .browser-session-veo.json  — Google account session cookies
 *   .browser-config-veo.json   — exact selectors for the prompt + generate button
 *
 * Run: npm run browser:setup:veo
 *
 * Target: https://aistudio.google.com (Google AI Studio with Veo 3)
 * Sign in with your Google account — uses the same account as Gmail/Drive.
 */

import { chromium, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import readline from 'readline'

const SESSION_FILE = path.join(process.cwd(), '.browser-session-veo.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config-veo.json')

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
  console.log('\n=== Hopcharge Veo 3 browser setup ===\n')
  console.log('Target: Google AI Studio (aistudio.google.com)')
  console.log('This saves your Google session and the Veo 3 UI element locations.\n')

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] })
  const context = await browser.newContext({ viewport: null })

  context.on('page', (p) => p.on('load', () => console.log(`  [tab] ${p.url()}`)))

  const page = await context.newPage()
  await page.goto('https://aistudio.google.com', { waitUntil: 'domcontentloaded' })

  // ── Step 1: Log in ──────────────────────────────────────────────────────────
  console.log('Step 1: Sign in with Google')
  console.log('  Use the same Google account you normally use.')
  console.log('  Google may open a sign-in popup — complete it normally.')
  await ask('  Press Enter once you are logged in and can see AI Studio... ')

  // ── Step 2: Navigate to Veo 3 video generation ─────────────────────────────
  console.log('\nStep 2: Navigate to Veo 3 video generation')
  console.log('  Look for "Generate media", "Video", or "Veo" in the left sidebar or top nav.')
  console.log('  Navigate until you see a text input for entering a video prompt.')
  console.log('  (If it opens in a new tab, that is fine.)')
  await ask('  Press Enter once the Veo video generation form is visible... ')

  const activePage = () => { const all = context.pages(); return all[all.length - 1] }
  const creationPage = activePage()
  await creationPage.waitForLoadState('domcontentloaded')
  const creationUrl = creationPage.url()
  console.log(`  ✓ Creation URL: ${creationUrl}`)

  // ── Step 3: Capture the prompt textarea ────────────────────────────────────
  console.log('\nStep 3: Click the prompt input')
  console.log('  Click directly on the text box where you type the video description.')
  const promptInfo = await captureNextClick(creationPage)
  const promptSelector = buildSelector(promptInfo)
  console.log(`  ✓ Prompt: <${promptInfo.tagName}> selector="${promptSelector}"`)

  // ── Step 4: Capture the generate button ────────────────────────────────────
  console.log('\nStep 4: Click the Generate button')
  console.log('  Click the button that starts Veo generation.')
  const generateInfo = await captureNextClick(creationPage)
  const generateSelector = buildSelector(generateInfo)
  console.log(`  ✓ Generate: <${generateInfo.tagName}> selector="${generateSelector}" text="${generateInfo.text}"`)

  // ── Save ───────────────────────────────────────────────────────────────────
  await context.storageState({ path: SESSION_FILE })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ creationUrl, promptSelector, promptInfo, generateSelector, generateInfo }, null, 2))

  await browser.close()

  console.log(`\n✓ Session saved → ${SESSION_FILE}`)
  console.log(`✓ Config saved  → ${CONFIG_FILE}`)
  console.log('\nSet VIDEO_GENERATOR=browser-veo in .env.local, then restart the dev server.\n')
}

main().catch((err) => { console.error('Setup failed:', err); process.exit(1) })
