import type { ImageGeneratorPlugin } from '../interfaces'

const BASE = 'https://api.replicate.com/v1'

// Flux Schnell - fastest, cheapest Flux model (~$0.003/image)
// Override via REPLICATE_FLUX_MODEL env var for flux-dev (higher quality) or flux-pro
const DEFAULT_MODEL = 'black-forest-labs/flux-schnell'

interface ReplicatePrediction {
  id: string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output?: string[]
  error?: string
}

export class ReplicateFluxGenerator implements ImageGeneratorPlugin {
  name = 'replicate'

  private get token() { return process.env.REPLICATE_API_TOKEN! }
  private get model() { return process.env.REPLICATE_FLUX_MODEL ?? DEFAULT_MODEL }

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      Prefer: 'wait=60',  // wait up to 60s synchronously before falling back to polling
    }
  }

  async generate({ prompt }: { prompt: string; referenceAssets?: string[] }): Promise<{ fileUrl: string }> {
    // Submit prediction
    const res = await fetch(`${BASE}/models/${this.model}/predictions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: '9:16',    // vertical - matches ad format
          output_format: 'jpg',
          output_quality: 90,
          num_outputs: 1,
        },
      }),
    })

    const prediction = await res.json() as ReplicatePrediction

    if (!prediction.id) {
      throw new Error(`Replicate submit failed: ${JSON.stringify(prediction)}`)
    }

    // If the Prefer: wait header resolved it synchronously, we're done
    if (prediction.status === 'succeeded' && prediction.output?.[0]) {
      return { fileUrl: prediction.output[0] }
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate generation failed: ${prediction.error ?? 'unknown error'}`)
    }

    // Otherwise poll until complete (max 3 minutes)
    return this.poll(prediction.id)
  }

  private async poll(id: string, attempts = 0): Promise<{ fileUrl: string }> {
    if (attempts > 36) throw new Error('Replicate timed out after 3 minutes')

    await new Promise(r => setTimeout(r, 5000))

    const res = await fetch(`${BASE}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    const prediction = await res.json() as ReplicatePrediction

    if (prediction.status === 'succeeded' && prediction.output?.[0]) {
      return { fileUrl: prediction.output[0] }
    }
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate generation failed: ${prediction.error ?? 'unknown error'}`)
    }

    return this.poll(id, attempts + 1)
  }
}
