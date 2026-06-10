import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { ImageGeneratorPlugin } from '../interfaces'
import type { Idea } from '@prisma/client'
import { writeJob, readJob } from './jobs'

const SESSION_FILE = path.join(process.cwd(), '.browser-session-flyne.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config-flyne.json')
const LOG_DIR      = path.join(process.cwd(), 'storage', 'browser-logs')
const TSX_BIN      = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
const AUTOMATION   = path.join(process.cwd(), 'src', 'lib', 'plugins', 'browser', 'automate-flyne.ts')

/**
 * Browser automation: drives flyne.ai image generation.
 * Setup (one-time): npm run browser:setup:flyne
 * Activate: IMAGE_GENERATOR=browser-flyne
 */
export class FlyneBrowserGenerator implements ImageGeneratorPlugin {
  name = 'browser-flyne'

  private buildPrompt(idea: Idea): string {
    return [
      idea.imageVisual,
      'Hopcharge ad — India\'s on-demand doorstep EV charging service: a branded white-and-blue mobile charging van comes to the customer.',
      'Setting: modern Delhi-NCR — upscale apartment complex, gated residential colony, or premium parking bay.',
      'Subject: confident Indian urban professional, 25–40 years old, relaxed beside their Tata EV.',
      'Brand aesthetic: clean, aspirational, tech-forward — white, electric blue, crisp.',
      'High-end advertising photography, cinematic lighting, sharp focus.',
      `Emotional tone: ${idea.angle.replace(/_/g, ' ')}.`,
      'Vertical 9:16, no text overlay, no watermark.',
    ].join(' ')
  }

  async generate({ prompt }: { prompt: string; referenceAssets?: string[] }): Promise<{ fileUrl: string; fileUrls?: string[] }> {
    if (!fs.existsSync(SESSION_FILE)) throw new Error('Flyne session not found. Run: npm run browser:setup:flyne')
    if (!fs.existsSync(CONFIG_FILE))  throw new Error('Flyne UI config not found. Run: npm run browser:setup:flyne')

    const jobId = `flyne-${crypto.randomUUID()}`

    fs.mkdirSync(LOG_DIR, { recursive: true })
    const logFile   = path.join(LOG_DIR, `${jobId}.log`)
    const logStream = fs.openSync(logFile, 'w')

    writeJob({ id: jobId, prompt, status: 'pending', startedAt: Date.now() })

    const child = spawn(TSX_BIN, [AUTOMATION], {
      detached: true,
      stdio: ['ignore', logStream, logStream],
      env: {
        ...process.env,
        JOB_ID: jobId,
        PROMPT: prompt,
        BROWSER_HEADLESS:     process.env.BROWSER_HEADLESS ?? 'false',
        BROWSER_SESSION_FILE: SESSION_FILE,
        BROWSER_CONFIG_FILE:  CONFIG_FILE,
        DISPLAY: process.env.DISPLAY ?? ':0',
      },
    })

    if (!child.pid) {
      throw new Error('Failed to spawn Flyne automation process')
    }
    console.log(`[flyne] Job ${jobId} started — PID ${child.pid} — log: ${logFile}`)
    child.unref()

    // Poll until complete (max 5 minutes)
    const deadline = Date.now() + 5 * 60 * 1000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000))
      const job = readJob(jobId)
      if (!job) continue
      if (job.status === 'complete' && job.fileUrl) {
        const result: { fileUrl: string; fileUrls?: string[] } = { fileUrl: job.fileUrl }
        if (job.fileUrls) result.fileUrls = job.fileUrls
        return result
      }
      if (job.status === 'failed') throw new Error(job.error ?? 'Flyne generation failed')
    }

    throw new Error('Flyne automation timed out after 5 minutes')
  }
}
