import type { VideoGeneratorPlugin, ImageGeneratorPlugin } from '../interfaces'
import type { Idea } from '@prisma/client'
import { buildVideoPrompt, NEGATIVE_VIDEO } from '../prompt-constants'

/**
 * Higgsfield image + video generation (platform.higgsfield.ai, v2 API).
 *
 * Verified against the official SDK (github.com/higgsfield-ai/higgsfield-js):
 *  - Auth:   `Authorization: Key <KEY_ID>:<KEY_SECRET>`  (NOT a bearer token)
 *  - Image:  POST /v1/text2image/soul   body sent FLAT (not wrapped)
 *  - Video:  POST /v1/image2video/dop   (image-to-video: needs a first frame)
 *  - Status: GET  /requests/{request_id}/status
 *  - Submit returns { request_id, status_url, cancel_url }
 *  - Status returns { status, images?:[{url}], video?:{url} }
 *    status ∈ queued | in_progress | completed | failed | nsfw | canceled
 *
 * CREDIT SAFETY: every credit-consuming call (image generate, video submit) is
 * gated behind HIGGSFIELD_ALLOW_GENERATION=true. If that flag is not set, the
 * methods throw BEFORE making any network request - so no credits can be spent
 * accidentally. Status polling and credential validation never consume credits.
 *
 * Sara consistency (see docs in this PR):
 *  - Image: pass a reference still via `image_reference`, or a trained character
 *    via `custom_reference_id` (a "Soul ID"). referenceAssets[0] > Soul ID env.
 *  - Video: the input first frame IS the reference - feed the idea's approved
 *    Sara image (a public/signed URL) as input_images[0].
 */

const BASE = process.env.HIGGSFIELD_BASE_URL ?? 'https://platform.higgsfield.ai'

function authHeader(): string {
  const id = process.env.HIGGSFIELD_KEY_ID
  const secret = process.env.HIGGSFIELD_KEY_SECRET
  if (!id || !secret) {
    throw new Error('Higgsfield credentials missing - set HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET')
  }
  return `Key ${id}:${secret}`
}

// Hard stop before ANY paid call. Throws (no network request) unless the operator
// has explicitly opted in. This is what guarantees zero accidental credit usage.
function assertGenerationAllowed(): void {
  if (process.env.HIGGSFIELD_ALLOW_GENERATION !== 'true') {
    throw new Error(
      'Higgsfield generation is disabled for credit safety. No API call was made and no credits were used. ' +
        'Set HIGGSFIELD_ALLOW_GENERATION=true to enable paid image/video generation.'
    )
  }
}

type HFStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled'
type OurStatus = 'pending' | 'processing' | 'complete' | 'failed'

interface HFSubmitResponse {
  request_id?: string
  id?: string
  status_url?: string
  cancel_url?: string
  // Some responses wrap the payload under `data` - check it too so we never lose a
  // request id after a (charged) submit.
  data?: HFSubmitResponse
}
interface HFStatusResponse {
  status?: HFStatus
  images?: Array<{ url?: string }>
  video?: { url?: string }
  // Defensive: the SDK's higher-level shape exposes results under jobs[].results.raw.url
  jobs?: Array<{ results?: { raw?: { url?: string } } }>
  error?: string
  message?: string
  data?: HFStatusResponse
}

async function hfFetch(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(), ...(init.headers ?? {}) },
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

function mapStatus(s: HFStatus | undefined): OurStatus {
  switch (s) {
    case 'queued': return 'pending'
    case 'in_progress': return 'processing'
    case 'completed': return 'complete'
    case 'failed':
    case 'nsfw':
    case 'canceled': return 'failed'
    default: return 'pending'
  }
}

// Pull the first media URL out of a status response, tolerating the few shapes the
// API / SDK use (images[].url, video.url, jobs[].results.raw.url).
function extractUrls(r: HFStatusResponse): string[] {
  const urls: string[] = []
  for (const img of r.images ?? []) if (img?.url) urls.push(img.url)
  if (r.video?.url) urls.push(r.video.url)
  for (const j of r.jobs ?? []) if (j?.results?.raw?.url) urls.push(j.results.raw.url)
  return urls
}

function requestId(r: HFSubmitResponse): string | undefined {
  return r.request_id ?? r.id ?? r.data?.request_id ?? r.data?.id
}

// Print the exact prompt + settings being sent to Higgsfield to the server console,
// so it can be copy-pasted into the Higgsfield dashboard for manual generation.
// Called BEFORE the credit gate / network call, so the prompt is captured even when
// generation is disabled (HIGGSFIELD_ALLOW_GENERATION != 'true').
function logHiggsfieldRequest(endpoint: string, body: Record<string, unknown>): void {
  const ref =
    (body.custom_reference_id ? `Soul ID ${body.custom_reference_id}` : undefined) ??
    (body.image_reference as { image_url?: string } | undefined)?.image_url ??
    (body.input_images as Array<{ image_url?: string }> | undefined)?.[0]?.image_url ??
    'none'
  const line = '═'.repeat(72)
  console.log(`\n${line}`)
  console.log(`Higgsfield ${endpoint} - copy this prompt into the dashboard:`)
  console.log(line)
  console.log(String(body.prompt ?? ''))
  console.log('─'.repeat(72))
  if (body.width_and_height) console.log(`size: ${body.width_and_height}    quality: ${body.quality}`)
  if (body.model) console.log(`model: ${body.model}`)
  console.log(`reference image to attach in the dashboard: ${ref}`)
  console.log(`${line}\n`)
}

async function getStatus(jobId: string): Promise<{ our: OurStatus; urls: string[]; error?: string }> {
  const { ok, status, json } = await hfFetch(`/requests/${jobId}/status`)
  const raw = json as HFStatusResponse
  const body = raw.data ?? raw // tolerate a `data` wrapper
  if (!ok) return { our: status === 404 ? 'pending' : 'failed', urls: [], error: `Higgsfield status HTTP ${status}: ${body.message ?? body.error ?? ''}` }
  const our = mapStatus(body.status)
  return { our, urls: extractUrls(body), error: our === 'failed' ? (body.error ?? body.message ?? `status=${body.status}`) : undefined }
}

// ── Image: text2image/soul ───────────────────────────────────────────────────

// Builds the Soul text2image input. Sara consistency: prefer an explicit reference
// still, else a trained Soul ID. Shared by submitJob() and generate().
function buildSoulBody(prompt: string, referenceAssets?: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt,
    width_and_height: process.env.HIGGSFIELD_SOUL_SIZE ?? '1536x2048', // vertical, closest Soul size to 9:16
    quality: process.env.HIGGSFIELD_SOUL_QUALITY ?? '1080p',
    batch_size: 1,
    enhance_prompt: false, // keep prompts deterministic; avoid any server-side prompt rewriting
  }
  const refImage = referenceAssets?.[0] ?? process.env.HIGGSFIELD_SARA_REFERENCE_URL
  const soulId = process.env.HIGGSFIELD_SARA_SOUL_ID
  if (soulId) {
    body.custom_reference_id = soulId
    body.custom_reference_strength = Number(process.env.HIGGSFIELD_SARA_REFERENCE_STRENGTH ?? 1)
  } else if (refImage) {
    body.image_reference = { type: 'image_url', image_url: refImage }
  }
  return body
}

export class HiggsfieldImageGenerator implements ImageGeneratorPlugin {
  name = 'higgsfield'

  // Async path (preferred): submit and return a job id immediately - no blocking.
  async submitJob({ prompt, referenceAssets }: { prompt: string; referenceAssets?: string[] }): Promise<{ jobId: string }> {
    const body = buildSoulBody(prompt, referenceAssets)
    logHiggsfieldRequest('text2image/soul', body) // logged before the gate so the prompt prints even if generation is disabled
    assertGenerationAllowed()
    // The API expects the generation input nested under `params`.
    const { ok, status, json } = await hfFetch('/v1/text2image/soul', {
      method: 'POST',
      body: JSON.stringify({ params: body }),
    })
    const id = requestId(json as HFSubmitResponse)
    if (!ok || !id) throw new Error(`Higgsfield image submit failed (HTTP ${status}): ${JSON.stringify(json)}`)
    return { jobId: id }
  }

  async pollJobStatus(jobId: string): Promise<{ status: OurStatus; fileUrls?: string[]; error?: string }> {
    const { our, urls, error } = await getStatus(jobId)
    if (our === 'complete') {
      if (urls.length === 0) return { status: 'failed', error: 'Higgsfield reported complete but returned no image URL' }
      return { status: 'complete', fileUrls: urls }
    }
    return { status: our, error }
  }

  // Synchronous convenience (submit + poll). Still used for the video keyframe path.
  async generate({ prompt, referenceAssets }: { prompt: string; referenceAssets?: string[] }): Promise<{ fileUrl: string; fileUrls?: string[] }> {
    const { jobId } = await this.submitJob({ prompt, referenceAssets })
    const urls = await this.poll(jobId)
    return { fileUrl: urls[0], fileUrls: urls }
  }

  // Soul is fast but async; poll until completed (cap ~3 min). No credits per poll.
  private async poll(jobId: string, attempts = 0): Promise<string[]> {
    if (attempts > 36) throw new Error('Higgsfield image generation timed out after ~3 minutes')
    await new Promise((r) => setTimeout(r, 5000))
    const { our, urls, error } = await getStatus(jobId)
    if (our === 'complete') {
      if (urls.length === 0) throw new Error('Higgsfield reported complete but returned no image URL')
      return urls
    }
    if (our === 'failed') throw new Error(`Higgsfield image generation failed: ${error ?? 'unknown'}`)
    return this.poll(jobId, attempts + 1)
  }
}

// ── Video: image2video/dop ───────────────────────────────────────────────────

export class HiggsfieldGenerator implements VideoGeneratorPlugin {
  name = 'higgsfield'

  async submitJob({ idea, referenceAssets }: { idea: Idea; referenceAssets?: string[] }): Promise<{ jobId: string }> {
    // image2video REQUIRES a first frame. Validate BEFORE the credit gate / network
    // so a misconfigured call can never spend a credit on a doomed request.
    const firstFrame = referenceAssets?.[0] ?? process.env.HIGGSFIELD_SARA_REFERENCE_URL
    if (!firstFrame) {
      throw new Error(
        'Higgsfield image2video needs a first-frame image. Pass referenceAssets[0] (e.g. the idea\'s approved Sara image as a public URL) ' +
          'or set HIGGSFIELD_SARA_REFERENCE_URL. No API call was made.'
      )
    }

    const body: Record<string, unknown> = {
      model: process.env.HIGGSFIELD_DOP_MODEL ?? 'dop-turbo', // dop-lite | dop-turbo | dop-standard
      prompt: `${buildVideoPrompt(idea.videoVisual)}\n\nAvoid: ${NEGATIVE_VIDEO}`,
      input_images: [{ type: 'image_url', image_url: firstFrame }],
      enhance_prompt: false,
    }
    const motionId = process.env.HIGGSFIELD_DOP_MOTION_ID
    if (motionId) body.motions = [{ id: motionId, strength: Number(process.env.HIGGSFIELD_DOP_MOTION_STRENGTH ?? 0.8) }]

    logHiggsfieldRequest('image2video/dop', body) // logged before the gate so the prompt prints even if generation is disabled
    assertGenerationAllowed()

    // The API expects the generation input nested under `params`.
    const { ok, status, json } = await hfFetch('/v1/image2video/dop', { method: 'POST', body: JSON.stringify({ params: body }) })
    const submit = json as HFSubmitResponse
    const id = requestId(submit)
    if (!ok || !id) {
      throw new Error(`Higgsfield video submit failed (HTTP ${status}): ${JSON.stringify(json)}`)
    }
    return { jobId: id }
  }

  async pollJobStatus(jobId: string): Promise<{ status: OurStatus; fileUrl?: string; error?: string }> {
    const { our, urls, error } = await getStatus(jobId)
    if (our === 'complete') {
      if (urls.length === 0) return { status: 'failed', error: 'Higgsfield reported complete but returned no video URL' }
      return { status: 'complete', fileUrl: urls[0] }
    }
    return { status: our, error }
  }

  // Best-effort cancel (used by the regenerate flow). Never throws; no credits.
  async cancelJob(jobId: string): Promise<void> {
    await hfFetch(`/requests/${jobId}/cancel`, { method: 'POST' }).catch(() => {})
  }
}

/**
 * Validate Higgsfield credentials WITHOUT spending credits. Issues a status check
 * for a throwaway id: a 401 means bad credentials, anything else (404/400) means
 * the key authenticated. Does not call any generation endpoint. Not invoked
 * automatically - run it from a script when you want to confirm the key works.
 */
export async function validateHiggsfieldAuth(): Promise<{ ok: boolean; httpStatus: number }> {
  const { status } = await hfFetch('/requests/00000000-0000-0000-0000-000000000000/status')
  return { ok: status !== 401 && status !== 403, httpStatus: status }
}

/**
 * Upload a local image to Higgsfield storage and return a durable, Higgsfield-hosted
 * public URL - reachable from their servers even when your own storage is local
 * (MinIO/Docker). Two-step presigned PUT: POST /files/generate-upload-url to get an
 * upload_url + public_url, then PUT the bytes to upload_url.
 *
 * This is a STORAGE operation, not a generation - it does not consume credits.
 */
export async function uploadHiggsfieldImage(bytes: Buffer | Uint8Array, contentType = 'image/png'): Promise<string> {
  const { ok, status, json } = await hfFetch('/files/generate-upload-url', {
    method: 'POST',
    body: JSON.stringify({ content_type: contentType }),
  })
  const { upload_url, public_url } = json as { upload_url?: string; public_url?: string }
  if (!ok || !upload_url || !public_url) {
    throw new Error(`Higgsfield upload-url request failed (HTTP ${status}): ${JSON.stringify(json)}`)
  }
  // The presigned PUT goes to storage directly - no Higgsfield auth header (it would
  // break the signature); only the content type.
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(bytes),
  })
  if (!put.ok) throw new Error(`Higgsfield image PUT failed (HTTP ${put.status})`)
  return public_url
}

/**
 * List existing Soul IDs (custom character references). Free - no credits.
 */
export async function listSoulIds(): Promise<unknown> {
  const { json } = await hfFetch('/v1/custom-references/list')
  return json
}

/**
 * Create a reusable "Soul ID" (custom character) for Sara from reference photos,
 * so every text2image call can lock to her face via custom_reference_id.
 *
 * COSTS CREDITS - this trains a character. It is NOT wired into any route/job and
 * is never called by the pipeline; run it deliberately, once, from a one-off
 * script. Put the returned id into HIGGSFIELD_SARA_SOUL_ID.
 *
 * @param name        a label, e.g. "Sara"
 * @param imageUrls   3-10 public URLs of clear, varied photos of Sara
 */
export async function createSoulId(name: string, imageUrls: string[]): Promise<{ id: string; raw: unknown }> {
  if (!imageUrls.length) throw new Error('createSoulId needs at least one reference image URL')
  const body = { name, input_images: imageUrls.map((image_url) => ({ type: 'image_url', image_url })) }
  const { ok, status, json } = await hfFetch('/v1/custom-references', { method: 'POST', body: JSON.stringify(body) })
  if (!ok) throw new Error(`Higgsfield createSoulId failed (HTTP ${status}): ${JSON.stringify(json)}`)

  // The create call may return the id directly, or a request_id to poll until the
  // character finishes training. Handle both defensively.
  const r = json as { id?: string; request_id?: string; status?: HFStatus; custom_reference_id?: string }
  let id = r.id ?? r.custom_reference_id
  const jobId = r.request_id
  if (!id && jobId) {
    for (let i = 0; i < 60 && !id; i++) {
      await new Promise((res) => setTimeout(res, 5000))
      const { json: s } = await hfFetch(`/requests/${jobId}/status`)
      const sr = s as { status?: HFStatus; id?: string; custom_reference_id?: string }
      if (sr.status === 'completed') id = sr.id ?? sr.custom_reference_id ?? jobId
      else if (sr.status === 'failed' || sr.status === 'nsfw' || sr.status === 'canceled') {
        throw new Error(`Higgsfield Soul ID training ${sr.status}`)
      }
    }
  }
  if (!id) throw new Error(`Higgsfield createSoulId: could not resolve a soul id from ${JSON.stringify(json)}`)
  return { id, raw: json }
}
