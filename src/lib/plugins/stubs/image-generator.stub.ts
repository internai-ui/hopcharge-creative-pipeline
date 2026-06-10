import type { ImageGeneratorPlugin } from '../interfaces'

export class ImageGeneratorStub implements ImageGeneratorPlugin {
  name = 'stub'

  async generate({ prompt }: { prompt: string; referenceAssets?: string[] }): Promise<{ fileUrl: string }> {
    // Returns a placeholder image URL
    const encoded = encodeURIComponent(prompt.slice(0, 50))
    return { fileUrl: `https://placehold.co/1080x1920/1a1a2e/ffffff?text=${encoded}` }
  }
}
