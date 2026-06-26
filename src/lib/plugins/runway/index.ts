import type { VideoGeneratorPlugin } from '../interfaces'
import type { Idea } from '@prisma/client'
import { buildVideoPrompt } from '../prompt-constants'

const BASE = 'https://api.dev.runwayml.com/v1'
const RUNWAY_VERSION = '2024-11-06'

interface RunwayTask {
  id: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'
  output?: string[]
  failure?: string
  failureCode?: string
}

function buildPrompt(idea: Idea): string {
  return buildVideoPrompt(idea.videoVisual)
}

export class RunwayGenerator implements VideoGeneratorPlugin {
  name = 'runway'

  private get token() { return process.env.RUNWAY_API_KEY! }

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      'X-Runway-Version': RUNWAY_VERSION,
    }
  }

  async submitJob({ idea }: { idea: Idea; referenceAssets?: string[] }): Promise<{ jobId: string }> {
    const res = await fetch(`${BASE}/text_to_video`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: process.env.RUNWAY_MODEL ?? 'veo3.1_fast',
        promptText: buildPrompt(idea),
        duration: Number(process.env.RUNWAY_DURATION ?? '8'),
        ratio: process.env.RUNWAY_RATIO ?? '1080:1920',
        watermark: false,
      }),
    })

    const data = await res.json() as RunwayTask & { message?: string }

    if (!data.id) {
      throw new Error(`Runway submit failed (${res.status}): ${data.message ?? JSON.stringify(data)}`)
    }

    return { jobId: data.id }
  }

  async cancelJob(jobId: string): Promise<void> {
    await fetch(`${BASE}/tasks/${jobId}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
  }

  async pollJobStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed'
    fileUrl?: string
    error?: string
  }> {
    const res = await fetch(`${BASE}/tasks/${jobId}`, { headers: this.headers() })
    const data = await res.json() as RunwayTask & { message?: string }

    if (!data.status) {
      return { status: 'failed', error: `Runway poll error: ${data.message ?? JSON.stringify(data)}` }
    }

    switch (data.status) {
      case 'PENDING':   return { status: 'pending' }
      case 'RUNNING':   return { status: 'processing' }
      case 'SUCCEEDED': {
        const url = data.output?.[0]
        if (!url) return { status: 'failed', error: 'Runway returned SUCCEEDED but no output URL' }
        return { status: 'complete', fileUrl: url }
      }
      case 'FAILED':
      case 'CANCELED':
        return { status: 'failed', error: data.failure ?? data.failureCode ?? 'Runway generation failed' }
      default:
        return { status: 'pending' }
    }
  }
}
