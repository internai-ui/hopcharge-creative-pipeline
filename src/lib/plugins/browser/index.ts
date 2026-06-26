import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { VideoGeneratorPlugin } from '../interfaces'
import type { Idea } from '@prisma/client'
import { writeJob, readJob } from './jobs'

const SESSION_FILE = path.join(process.cwd(), '.browser-session.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config.json')
const LOG_DIR = path.join(process.cwd(), 'storage', 'browser-logs')

// Use the project-local tsx binary - more reliable than `npx tsx` in spawned processes
const TSX_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
// Script path relative to cwd - avoids __dirname resolving to .next/server
const AUTOMATION_SCRIPT = path.join(process.cwd(), 'src', 'lib', 'plugins', 'browser', 'automate-kling.ts')

/**
 * Browser automation video generator.
 *
 * Uses Playwright to drive the Kling AI web interface (free tier) instead of the paid API.
 * Swap for the real Kling or Runway plugin when you have API credits.
 *
 * Setup (one-time):  npm run browser:setup
 * Activate:          VIDEO_GENERATOR=browser in .env.local
 */
export class BrowserVideoGenerator implements VideoGeneratorPlugin {
  name = 'browser'

  private buildPrompt(idea: Idea): string {
    return [
      idea.videoVisual,
      'Professional advertising video for an EV home charging service in India.',
      'Cinematic lighting, smooth camera movement, modern urban aesthetic.',
    ].join(' ')
  }

  async submitJob({ idea }: { idea: Idea; referenceAssets?: string[] }): Promise<{ jobId: string }> {
    if (!fs.existsSync(SESSION_FILE)) {
      throw new Error('Browser session not found. Run: npm run browser:setup')
    }
    if (!fs.existsSync(CONFIG_FILE)) {
      throw new Error('Browser UI config not found. Run: npm run browser:setup (it will ask you to click the prompt and generate button)')
    }

    const jobId = `browser-${crypto.randomUUID()}`
    const prompt = this.buildPrompt(idea)

    fs.mkdirSync(LOG_DIR, { recursive: true })
    const logFile = path.join(LOG_DIR, `${jobId}.log`)

    writeJob({ id: jobId, prompt, status: 'pending', startedAt: Date.now() })

    // Pipe stdout/stderr to a log file so errors are visible
    const logStream = fs.openSync(logFile, 'w')

    const child = spawn(TSX_BIN, [AUTOMATION_SCRIPT], {
      detached: true,
      stdio: ['ignore', logStream, logStream],
      env: {
        ...process.env,
        JOB_ID: jobId,
        PROMPT: prompt,
        BROWSER_HEADLESS: process.env.BROWSER_HEADLESS ?? 'false',
        BROWSER_SESSION_FILE: SESSION_FILE,
        // Explicitly forward the display so the browser window is visible on Linux/Mac
        DISPLAY: process.env.DISPLAY ?? ':0',
      },
    })

    if (child.pid) {
      writeJob({ id: jobId, prompt, status: 'pending', startedAt: Date.now(), pid: child.pid })
      console.log(`[browser] Job ${jobId} started - PID ${child.pid} - log: ${logFile}`)
    } else {
      writeJob({ id: jobId, prompt, status: 'failed', error: 'Failed to spawn automation process', startedAt: Date.now() })
      throw new Error('Failed to spawn browser automation process')
    }

    child.on('error', (err) => {
      console.error(`[browser] Spawn error for job ${jobId}:`, err)
      writeJob({ id: jobId, prompt, status: 'failed', error: `Spawn error: ${err.message}`, startedAt: Date.now() })
    })

    child.unref()
    return { jobId }
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = readJob(jobId)
    if (!job) return

    if (job.pid) {
      try {
        process.kill(-job.pid, 'SIGTERM')
      } catch {
        try { process.kill(job.pid, 'SIGTERM') } catch { /* already gone */ }
      }
    }

    writeJob({ ...job, status: 'failed', error: 'Cancelled by user' })
  }

  async pollJobStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed'
    fileUrl?: string
    error?: string
  }> {
    const job = readJob(jobId)
    if (!job) return { status: 'failed', error: `Browser job ${jobId} not found` }

    const age = Date.now() - job.startedAt
    if ((job.status === 'pending' || job.status === 'processing') && age > 8 * 60 * 1000) {
      return { status: 'failed', error: 'Browser automation timed out after 8 minutes' }
    }

    return { status: job.status, fileUrl: job.fileUrl, error: job.error }
  }
}
