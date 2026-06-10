import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { VideoGeneratorPlugin } from '../interfaces'
import type { Idea } from '@prisma/client'
import { writeJob, readJob } from './jobs'

const SESSION_FILE = path.join(process.cwd(), '.browser-session-veo.json')
const CONFIG_FILE  = path.join(process.cwd(), '.browser-config-veo.json')
const LOG_DIR      = path.join(process.cwd(), 'storage', 'browser-logs')
const TSX_BIN      = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
const AUTOMATION   = path.join(process.cwd(), 'src', 'lib', 'plugins', 'browser', 'automate-veo.ts')

/**
 * Browser automation: drives Google AI Studio (aistudio.google.com) Veo 3 free interface.
 * Setup: npm run browser:setup:veo
 * Activate: VIDEO_GENERATOR=browser-veo
 */
export class VeoBrowserGenerator implements VideoGeneratorPlugin {
  name = 'browser-veo'

  private buildPrompt(idea: Idea): string {
    return [
      idea.videoVisual,
      'Hopcharge ad video — India\'s on-demand doorstep EV charging service.',
      'A branded white-and-blue Hopcharge mobile charging van arrives at a modern Delhi-NCR apartment complex or gated colony.',
      'Indian urban professional (25–40) connects their Tata EV — calm, effortless.',
      'Gurugram or Noida cityscape backdrop: glass towers, wide clean roads, golden hour or bright daylight.',
      'Cinematic lighting, smooth camera movement, aspirational tech-forward mood, high production quality. 9:16 vertical.',
    ].join(' ')
  }

  async submitJob({ idea }: { idea: Idea; referenceAssets?: string[] }): Promise<{ jobId: string }> {
    if (!fs.existsSync(SESSION_FILE)) throw new Error('Veo session not found. Run: npm run browser:setup:veo')
    if (!fs.existsSync(CONFIG_FILE))  throw new Error('Veo UI config not found. Run: npm run browser:setup:veo')

    const jobId  = `veo-${crypto.randomUUID()}`
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
      console.log(`[veo] Job ${jobId} started — PID ${child.pid} — log: ${logFile}`)
    } else {
      writeJob({ id: jobId, prompt, status: 'failed', error: 'Failed to spawn', startedAt: Date.now() })
      throw new Error('Failed to spawn Veo automation process')
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
