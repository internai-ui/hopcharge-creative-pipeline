/**
 * File-based job store for browser-automated video generation.
 * Jobs are written to ./storage/browser-jobs/{id}.json so they survive
 * server restarts and can be read by pollJobStatus.
 */

import fs from 'fs'
import path from 'path'

const DIR = path.join(process.cwd(), 'storage', 'browser-jobs')

export type BrowserJobState = {
  id: string
  prompt: string
  status: 'pending' | 'processing' | 'complete' | 'failed'
  fileUrl?: string
  fileUrls?: string[]  // multiple images (e.g. ElevenLabs generates 4)
  error?: string
  startedAt: number
  pid?: number
}

function filePath(id: string) {
  return path.join(DIR, `${id}.json`)
}

export function writeJob(state: BrowserJobState) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(filePath(state.id), JSON.stringify(state, null, 2))
}

export function readJob(id: string): BrowserJobState | null {
  try {
    const raw = fs.readFileSync(filePath(id), 'utf8')
    return JSON.parse(raw) as BrowserJobState
  } catch {
    return null
  }
}
