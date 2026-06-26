import { buildVideoPrompt } from '../prompt-constants'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { VideoGeneratorPlugin } from '../interfaces'
import type { Idea } from '@prisma/client'
import { writeJob, readJob } from './jobs'

const SESSION_FILE = path.join(process.cwd(), '.browser-session-runway.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config-runway.json')
const LOG_DIR      = path.join(process.cwd(), 'storage', 'browser-logs')
const TSX_BIN      = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
const AUTOMATION   = path.join(process.cwd(), 'src', 'lib', 'plugins', 'browser', 'automate-runway.ts')

/**
 * Browser automation: drives app.runwayml.com free web interface.
 * Setup: npm run browser:setup:runway
 * Activate: VIDEO_GENERATOR=browser-runway
 */
export class RunwayBrowserGenerator implements VideoGeneratorPlugin {
  name = 'browser-runway'

  private buildPrompt(idea: Idea): string {
    return buildVideoPrompt(idea.videoVisual, { brief: true })
  }

  async submitJob({ idea }: { idea: Idea; referenceAssets?: string[] }): Promise<{ jobId: string }> {
    if (!fs.existsSync(SESSION_FILE)) throw new Error('Runway session not found. Run: npm run browser:setup:runway')
    if (!fs.existsSync(CONFIG_FILE))  throw new Error('Runway UI config not found. Run: npm run browser:setup:runway')

    const jobId  = `runway-${crypto.randomUUID()}`
    const prompt = this.buildPrompt(idea)

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

    if (child.pid) {
      writeJob({ id: jobId, prompt, status: 'pending', startedAt: Date.now(), pid: child.pid })
      console.log(`[runway-browser] Job ${jobId} started - PID ${child.pid} - log: ${logFile}`)
    } else {
      writeJob({ id: jobId, prompt, status: 'failed', error: 'Failed to spawn', startedAt: Date.now() })
      throw new Error('Failed to spawn Runway automation process')
    }

    child.on('error', (err) => {
      writeJob({ id: jobId, prompt, status: 'failed', error: `Spawn error: ${err.message}`, startedAt: Date.now() })
    })

    child.unref()
    return { jobId }
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = readJob(jobId)
    if (!job) return
    if (job.pid) {
      try { process.kill(-job.pid, 'SIGTERM') } catch {
        try { process.kill(job.pid, 'SIGTERM') } catch { /* gone */ }
      }
    }
    writeJob({ ...job, status: 'failed', error: 'Cancelled by user' })
  }

  async pollJobStatus(jobId: string): Promise<{ status: 'pending' | 'processing' | 'complete' | 'failed'; fileUrl?: string; error?: string }> {
    const job = readJob(jobId)
    if (!job) return { status: 'failed', error: `Job ${jobId} not found` }
    if ((job.status === 'pending' || job.status === 'processing') && Date.now() - job.startedAt > 10 * 60 * 1000) {
      return { status: 'failed', error: 'Timed out after 10 minutes' }
    }
    return { status: job.status, fileUrl: job.fileUrl, error: job.error }
  }
}
