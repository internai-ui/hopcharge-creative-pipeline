import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { ImageGeneratorPlugin } from '../interfaces'
import { writeJob, readJob } from './jobs'

const SESSION_FILE = path.join(process.cwd(), '.browser-session-flux.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config-flux.json')
const LOG_DIR      = path.join(process.cwd(), 'storage', 'browser-logs')
const TSX_BIN      = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
const AUTOMATION   = path.join(process.cwd(), 'src', 'lib', 'plugins', 'browser', 'automate-flux.ts')

/**
 * Browser automation: drives HuggingFace FLUX.1-schnell (free, no account needed).
 * Drop-in replacement for ReplicateFluxGenerator.
 *
 * Setup (one-time): npm run browser:setup:flux
 * Activate: IMAGE_GENERATOR=browser-flux
 */
export class FluxBrowserGenerator implements ImageGeneratorPlugin {
  name = 'browser-flux'

  async generate({ prompt }: { prompt: string; referenceAssets?: string[] }): Promise<{ fileUrl: string }> {
    if (!fs.existsSync(SESSION_FILE)) throw new Error('ElevenLabs session not found. Run: npm run browser:setup:flux')
    if (!fs.existsSync(CONFIG_FILE))  throw new Error('Flux UI config not found. Run: npm run browser:setup:flux')

    const jobId = `flux-${crypto.randomUUID()}`

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
      throw new Error('Failed to spawn Flux browser automation')
    }

    console.log(`[flux] Job ${jobId} started — PID ${child.pid} — log: ${logFile}`)
    child.unref()

    // Poll the job file until complete — image gen is fast (15–60s)
    const deadline = Date.now() + 3 * 60 * 1000 // 3 min max
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000))

      const job = readJob(jobId)
      if (!job) continue

      if (job.status === 'complete' && job.fileUrl) {
        const result: { fileUrl: string; fileUrls?: string[] } = { fileUrl: job.fileUrl }
        if (job.fileUrls) result.fileUrls = job.fileUrls
        return result
      }

      if (job.status === 'failed') {
        throw new Error(job.error ?? 'Flux browser generation failed')
      }
    }

    throw new Error('Flux browser automation timed out after 3 minutes')
  }
}
