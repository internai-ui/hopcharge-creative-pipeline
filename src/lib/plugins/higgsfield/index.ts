import type { VideoGeneratorPlugin } from '../interfaces'
import type { Idea } from '@prisma/client'

/**
 * Higgsfield video generator stub.
 *
 * Implementation notes:
 * - API base URL: https://api.higgsfield.ai/v1
 * - Auth: Bearer token via HIGGSFIELD_API_KEY env var
 * - submitJob: POST /generations with body { prompt, style, aspect_ratio, duration }
 *   Build the prompt from idea.hook + idea.visual. Style: "cinematic" or "ugc".
 *   Returns { id: string } — use as jobId.
 * - pollJobStatus: GET /generations/{id}
 *   Response: { status: "queued" | "processing" | "completed" | "failed", output_url?: string }
 *   Map their statuses to our interface: queued→pending, completed→complete.
 * - Download the file from output_url and save to storage using the storage provider.
 * - Rate limits: check their docs — may need exponential backoff in poll-creative-status job.
 */
export class HiggsfieldGenerator implements VideoGeneratorPlugin {
  name = 'higgsfield'

  async submitJob({ idea }: { idea: Idea; referenceAssets?: string[] }): Promise<{ jobId: string }> {
    throw new Error(
      `HiggsfieldGenerator.submitJob not implemented. ` +
        `Set VIDEO_GENERATOR=stub to use the stub adapter. ` +
        `To implement: POST https://api.higgsfield.ai/v1/generations ` +
        `with prompt built from idea.hook="${idea.hook}" and idea.videoVisual="${idea.videoVisual}".`
    )
  }

  async pollJobStatus(_jobId: string): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed'
    fileUrl?: string
    error?: string
  }> {
    throw new Error(
      `HiggsfieldGenerator.pollJobStatus not implemented. ` +
        `To implement: GET https://api.higgsfield.ai/v1/generations/{jobId}`
    )
  }
}
