import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  if (!/^[\w.-]+$/.test(filename)) {
    return new Response('Invalid filename', { status: 400 })
  }

  const filePath = path.join(process.cwd(), 'storage', 'browser-images', filename)

  if (!fs.existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg'
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

  const stream = fs.createReadStream(filePath)
  return new Response(stream as unknown as ReadableStream, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' },
  })
}
