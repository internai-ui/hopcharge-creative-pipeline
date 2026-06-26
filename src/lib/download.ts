// Fetch a remote image (e.g. a generator's CDN URL) into a buffer, inferring the
// file extension from the response Content-Type. Used by the async image pollers.
export async function downloadImageBuffer(url: string): Promise<{ buffer: Buffer; ext: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${url}`)
  const contentType = res.headers.get('content-type') ?? ''
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
  return { buffer: Buffer.from(await res.arrayBuffer()), ext }
}
