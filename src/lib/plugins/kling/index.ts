import crypto from 'crypto'
import type { VideoGeneratorPlugin } from '../interfaces'
import type { Idea } from '@prisma/client'

const BASE = 'https://api.klingai.com'

// Kling uses HS256 JWT auth — generate a fresh token per request (expires in 30 min)
function generateToken(): string {
  const accessKey = process.env.KLING_ACCESS_KEY!
  const secretKey = process.env.KLING_SECRET_KEY!
  const now = Math.floor(Date.now() / 1000)

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
  })).toString('base64url')

  const sig = crypto
    .createHmac('sha256', secretKey)
    .update(`${header}.${payload}`)
    .digest('base64url')

  return `${header}.${payload}.${sig}`
}

function buildPrompt(idea: Idea): { prompt: string; negative_prompt: string } {
  // Kling needs a visual description, not dialogue — combine the visual field
  // with context so the model produces something usable as an ad
  const parts = [
    idea.videoVisual,
    'Hopcharge ad video — India\'s on-demand doorstep EV charging service.',
    'A branded white-and-blue Hopcharge mobile charging van arrives at a modern Delhi-NCR apartment complex or gated colony.',
    'Indian urban professional (25–40) connects their Tata EV — calm, effortless.',
    'Gurugram or Noida cityscape backdrop: glass towers, wide clean roads, golden hour or bright daylight.',
    'Cinematic lighting, smooth camera movement, aspirational tech-forward mood, high production quality.',
  ]
  const prompt = parts.join(' ')

  const negative_prompt = [
    'blurry, low quality, grainy, shaky camera',
    'watermark, text overlay, subtitles, logo',
    'overexposed, underexposed, distorted',
    'cartoon, animation, drawing',
    'petrol station, gas pump, rural setting, Western suburb, non-Indian setting',
  ].join(', ')

  return { prompt, negative_prompt }
}

interface KlingSubmitResponse {
  code: number
  message: string
  data?: {
    task_id: string
    task_status: string
  }
}

interface KlingPollResponse {
  code: number
  message: string
  data?: {
    task_id: string
    task_status: 'submitted' | 'processing' | 'succeed' | 'failed'
    task_status_msg?: string
    task_result?: {
      videos?: Array<{ id: string; url: string; duration: string }>
    }
  }
}

export class KlingGenerator implements VideoGeneratorPlugin {
  name = 'kling'

  async submitJob({ idea }: { idea: Idea; referenceAssets?: string[] }): Promise<{ jobId: string }> {
    const { prompt, negative_prompt } = buildPrompt(idea)

    const body = {
      model_name: process.env.KLING_MODEL ?? 'kling-v1',
      prompt,
      negative_prompt,
      cfg_scale: 0.5,
      mode: 'std',
      aspect_ratio: '9:16',
      duration: '5',
    }

    const res = await fetch(`${BASE}/v1/videos/text2video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${generateToken()}`,
      },
      body: JSON.stringify(body),
    })

    const data = await res.json() as KlingSubmitResponse

    if (data.code !== 0 || !data.data?.task_id) {
      throw new Error(`Kling submit failed (code ${data.code}): ${data.message}`)
    }

    return { jobId: data.data.task_id }
  }

  async pollJobStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed'
    fileUrl?: string
    error?: string
  }> {
    const res = await fetch(`${BASE}/v1/videos/text2video/${jobId}`, {
      headers: { Authorization: `Bearer ${generateToken()}` },
    })

    const data = await res.json() as KlingPollResponse

    if (data.code !== 0 || !data.data) {
      return { status: 'failed', error: `Kling poll error (code ${data.code}): ${data.message}` }
    }

    const { task_status, task_result, task_status_msg } = data.data

    switch (task_status) {
      case 'submitted':
        return { status: 'pending' }
      case 'processing':
        return { status: 'processing' }
      case 'succeed': {
        const url = task_result?.videos?.[0]?.url
        if (!url) return { status: 'failed', error: 'Kling returned succeed but no video URL' }
        return { status: 'complete', fileUrl: url }
      }
      case 'failed':
        return { status: 'failed', error: task_status_msg ?? 'Kling generation failed' }
      default:
        return { status: 'pending' }
    }
  }
}
