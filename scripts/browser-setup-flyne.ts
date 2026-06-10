/**
 * One-time browser session setup for Flyne.ai.
 *
 * Saves two things:
 *   .browser-session-flyne.json  — cookies / login state
 *   .browser-config-flyne.json   — exact selectors for prompt + generate button
 *
 * Run: npm run browser:setup:flyne
 * Target: https://flyne.ai
 */

import { chromium, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import readline from 'readline'

const SESSION_FILE = path.join(process.cwd(), '.browser-session-flyne.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config-flyne.json')

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
  if (info.dataTestId)                   return `[data-testid="${info.dataTestId}"]`
  if (info.ariaLabel)                    return `[aria-label="${info.ariaLabel}"]`
  if (info.placeholder)                  return `[placeholder="${info.placeholder}"]`
  if (info.name)                         return `${info.tagName}[name="${info.name}"]`
  if (info.role)                         return `[role="${info.role}"]`
  if (info.contenteditable === 'true')   return '[contenteditable="true"]'
  const stableClass = info.className?.split(' ').find(c => c && !/\d{4,}/.test(c) && !/[:\[\]()#.+~>^$*|]/.test(c))
  if (stableClass)                       return `${info.tagName}.${stableClass}`
  return info.tagName
}

async function main() {
  console.log('\n=== Flyne.ai browser setup ===\n')
  console.log('Target: https://flyne.ai\n')

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] })
  const context = await browser.newContext({ viewport: null })
  context.on('page', (p) => p.on('load', () => console.log(`  [tab] ${p.url()}`)))

  const page = await context.newPage()
  await page.goto('https://flyne.ai', { waitUntil: 'domcontentloaded' })

  // ── Step 1: Log in ──────────────────────────────────────────────────────────
  console.log('Step 1: Log in to Flyne.ai')
  console.log('  Sign in using your preferred method.')
  console.log('  Any OAuth popups will open in new tabs automatically.')
  await ask('  Press Enter once you are logged in... ')

  // ── Step 2: Navigate to image generation + select model ────────────────────
  console.log('\nStep 2: Navigate to image generation and select your model')
  console.log('  1. Click on the Image generation section')
  console.log('  2. Select the model you want to use for generating ads')
  console.log('  3. Make sure the prompt input is visible on screen')
  await ask('  Press Enter once you have selected the model and can see the prompt input... ')

  const activePage = () => { const all = context.pages(); return all[all.length - 1] }
  const creationPage = activePage()
  await creationPage.waitForLoadState('domcontentloaded')
  const creationUrl = creationPage.url()
  console.log(`  ✓ URL: ${creationUrl}`)

  // ── Optional: Capture model selection clicks ────────────────────────────────
  console.log('\nOptional: Record model selection steps (for automation replay)')
  console.log('  If reaching the prompt required clicking through menus/models,')
  console.log('  we can record those clicks so automation can replay them.')
  const recordModelSteps = await new Promise<boolean>((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
    rl.question('  Did you have to click menus or select a model to reach the prompt? (y/n) ', (ans: string) => {
      rl.close()
      resolve(ans.trim().toLowerCase() === 'y')
    })
  })

  const modelSelectionSteps: Array<Record<string, string>> = []

  if (recordModelSteps) {
    console.log('\n  Recording model selection steps.')
    console.log('  Navigate BACK to where you started (before the model selection).')
    await ask('  Press Enter when you are at the starting point... ')

    let stepNum = 1
    while (true) {
      console.log(`\n  Step ${stepNum}: Click the next element needed to reach the prompt input.`)
      console.log('  (Press Enter without clicking if you are done recording steps)')

      // Register listener then wait
      await creationPage.evaluate(() => {
        (window as unknown as Record<string, unknown>).__capturedEl = undefined
        document.addEventListener('click', (e) => {
          let el = e.target as HTMLElement
          for (let i = 0; i < 6; i++) {
            if (el.id || el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.tagName === 'BUTTON' || el.tagName === 'A') {
              break
            }
            if (!el.parentElement) break
            el = el.parentElement
          }
          ;(window as unknown as Record<string, unknown>).__capturedEl = {
            tagName: el.tagName.toLowerCase(),
            id: el.id || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            dataTestId: el.getAttribute('data-testid') || '',
            className: el.getAttribute('class') || '',
            text: el.textContent?.trim().slice(0, 60) || '',
          }
        }, { once: true, capture: true })
      })

      const stepAnswer = await new Promise<string>((resolve) => {
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
        rl.question(`  Click step ${stepNum} element, then press Enter (or just Enter to finish): `, (ans: string) => {
          rl.close()
          resolve(ans)
        })
      })

      const captured = await creationPage.evaluate(() => (window as unknown as Record<string, unknown>).__capturedEl) as Record<string, string> | null

      if (!captured || !captured.tagName) {
        console.log(`  Done recording ${stepNum - 1} step(s).`)
        break
      }

      const sel = captured.id ? `#${captured.id}` :
                  captured.dataTestId ? `[data-testid="${captured.dataTestId}"]` :
                  captured.ariaLabel ? `[aria-label="${captured.ariaLabel}"]` :
                  captured.tagName
      modelSelectionSteps.push({ selector: sel, text: captured.text, ...captured })
      console.log(`  ✓ Step ${stepNum}: <${captured.tagName}> selector="${sel}" text="${captured.text}"`)
      stepNum++
      await creationPage.waitForTimeout(800)
    }

    if (modelSelectionSteps.length > 0) {
      await ask(`  Navigate back to the prompt input view, then press Enter... `)
    }
  }

  // ── Step 2: Capture the prompt input (with validation) ────────────────────
  console.log('\nStep 2: Click the prompt text input')
  console.log('  Click DIRECTLY on the large text area where you type the image description.')
  console.log('  Do NOT click on dropdowns, buttons, or settings — only the text input itself.\n')

  let promptInfo: Record<string, string>
  let promptSelector: string

  while (true) {
    promptInfo = await captureNextClick(creationPage)
    promptSelector = buildSelector(promptInfo)

    const isTextInput =
      promptInfo.tagName === 'textarea' ||
      promptInfo.tagName === 'input' ||
      promptInfo.contenteditable === 'true' ||
      promptInfo.role === 'textbox' ||
      promptInfo.ariaLabel?.toLowerCase().includes('prompt') ||
      promptInfo.placeholder?.length > 0

    if (isTextInput) {
      console.log(`  ✓ Prompt: <${promptInfo.tagName}> selector="${promptSelector}"`)
      break
    }

    console.log(`  ✗ Captured a <${promptInfo.tagName}> (${promptInfo.text.slice(0, 40) || 'no text'}) — that is not a text input.`)
    console.log('  Please click directly on the text area where you TYPE the prompt.\n')
  }

  // ── Step 3: Capture the generate button (without wasting credits) ─────────
  console.log('\nStep 3: Identify the Generate button')
  console.log('  The button is greyed out until text is entered.')
  console.log('  The setup will temporarily inject "x" into the prompt to enable it.')
  console.log('  Click the Generate button — generation is intercepted and cancelled immediately.')
  console.log('  Nothing will actually be generated.\n')

  // Block all POST/PUT requests so clicking generate does nothing server-side
  await creationPage.route('**/*', async (route) => {
    const req = route.request()
    if (req.method() === 'POST' || req.method() === 'PUT') {
      console.log(`  [blocked] ${req.method()} ${req.url().slice(0, 80)}`)
      await route.abort()
    } else {
      await route.continue()
    }
  })

  console.log('  Network requests are now blocked — clicking Generate cannot spend credits.')
  console.log('  In the browser: type any single character in the prompt box to enable the button.')
  await ask('  Press Enter once the Generate button is enabled (no longer greyed out)... ')

  const generateInfo = await captureNextClick(creationPage)
  const generateSelector = buildSelector(generateInfo)

  // Restore network and clear whatever was typed
  await creationPage.unrouteAll()
  await creationPage.keyboard.press('Control+a')
  await creationPage.keyboard.press('Delete')
  console.log(`  ✓ Generate: <${generateInfo.tagName}> selector="${generateSelector}" text="${generateInfo.text}"`)

  // ── Save ───────────────────────────────────────────────────────────────────
  await context.storageState({ path: SESSION_FILE })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(
    { creationUrl, promptSelector, promptInfo, generateSelector, generateInfo, modelSelectionSteps },
    null, 2
  ))

  await browser.close()

  console.log(`\n✓ Session saved → ${SESSION_FILE}`)
  console.log(`✓ Config saved  → ${CONFIG_FILE}`)
  console.log('\nTo activate: set IMAGE_GENERATOR=browser-flyne in .env.local and restart.\n')
}

main().catch((err) => { console.error('Setup failed:', err); process.exit(1) })
