import type { VideoGeneratorPlugin } from '../interfaces'

const jobStore = new Map<string, { status: 'pending' | 'processing' | 'complete' | 'failed'; startedAt: number }>()

export class VideoGeneratorStub implements VideoGeneratorPlugin {
  name = 'stub'

  async submitJob({ idea }: { idea: { id: string } }): Promise<{ jobId: string }> {
    const jobId = `stub-job-${idea.id}-${Date.now()}`
    jobStore.set(jobId, { status: 'pending', startedAt: Date.now() })
    return { jobId }
  }

  async pollJobStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed'
    fileUrl?: string
    error?: string
  }> {
    const job = jobStore.get(jobId)
    if (!job) return { status: 'failed', error: 'Job not found' }

    const elapsed = Date.now() - job.startedAt

    if (elapsed < 5000) return { status: 'pending' }
    if (elapsed < 15000) return { status: 'processing' }

    // Stub "completes" after 15 seconds with a placeholder URL
    return {
      status: 'complete',
      fileUrl: `https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4`,
    }
  }
}
