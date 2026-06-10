/**
 * One-time browser session setup for Kling AI.
 *
 * Saves two things:
 *   .browser-session.json  — cookies / login state
 *   .browser-config.json   — exact selectors for the prompt + generate button
 *
 * Run: npm run browser:setup
 */

import { chromium, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import readline from 'readline'

const SESSION_FILE = path.join(process.cwd(), '.browser-session.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config.json')

function ask(question: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, () => { rl.close(); resolve() })
  })
}

/** Installs a click listener that records the next element the user clicks. */
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

/** Builds the most reliable selector from captured element info. */
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
  console.log('\n=== Hopcharge browser setup ===\n')
  console.log('This will save your login and the exact UI elements to click.')
  console.log('Opening Chrome at kling.ai/app...\n')

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] })
  const context = await browser.newContext({ viewport: null })

  // Track all pages — Kling opens Video Generation in a new tab
  context.on('page', (p) => {
    p.on('load', () => console.log(`  [tab loaded] ${p.url()}`))
  })

  const page = await context.newPage()
  await page.goto('https://kling.ai/app', { waitUntil: 'domcontentloaded' })

  // Helper: always use the most recently opened / active page
  const activePage = () => {
    const all = context.pages()
    return all[all.length - 1]
  }

  // ── Step 1: Log in ──────────────────────────────────────────────────────────
  console.log('Step 1: Log in')
  console.log('  Sign in with Google (the popup will open automatically).')
  await ask('  Press Enter once you are fully logged in and can see your dashboard... ')

  // ── Step 2: Navigate to video creation ─────────────────────────────────────
  console.log('\nStep 2: Navigate to the video creation page')
  console.log('  Click "Video Generation" or whatever opens the text-to-video form.')
  console.log('  If it opens in a new tab, that\'s fine — just make sure that tab is in focus.')
  await ask('  Press Enter once you can see the text prompt input for video generation... ')

  // Use the most recently opened page (the new tab Kling opened)
  const creationPage = activePage()
  await creationPage.waitForLoadState('domcontentloaded')
  const creationUrl = creationPage.url()
  console.log(`  ✓ Creation page URL: ${creationUrl}`)

  // ── Step 3: Capture the prompt textarea ────────────────────────────────────
  console.log('\nStep 3: Click the prompt input')
  console.log('  Click directly on the text box where you type the video description.')
  const promptInfo = await captureNextClick(creationPage)
  const promptSelector = buildSelector(promptInfo)
  console.log(`  ✓ Prompt: <${promptInfo.tagName}> selector="${promptSelector}"`)
  console.log(`    placeholder="${promptInfo.placeholder}"`)

  // ── Step 4: Capture the generate button ────────────────────────────────────
  console.log('\nStep 4: Click the Generate button')
  console.log('  Click the button that submits and starts generation.')
  const generateInfo = await captureNextClick(creationPage)
  const generateSelector = buildSelector(generateInfo)
  console.log(`  ✓ Generate button: <${generateInfo.tagName}> selector="${generateSelector}"`)
  console.log(`    text="${generateInfo.text}"`)

  // ── Save everything ────────────────────────────────────────────────────────
  await context.storageState({ path: SESSION_FILE })

  const config = {
    creationUrl,
    promptSelector,
    promptInfo,
    generateSelector,
    generateInfo,
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))

  await browser.close()

  console.log(`\n✓ Session saved  → ${SESSION_FILE}`)
  console.log(`✓ UI config saved → ${CONFIG_FILE}`)
  console.log('\nSetup complete. Click "Generate video" on any idea to test.\n')
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exit(1)
})
