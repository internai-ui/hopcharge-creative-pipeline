import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { NextRequest } from 'next/server'

const MIME: Record<string, string> = {
  mp4:  'video/mp4',
  webm: 'video/webm',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const creative = await prisma.creative.findUnique({ where: { id } })
    if (!creative) return Response.json({ error: 'Creative not found' }, { status: 404 })

    const filePath = creative.editedFilePath ?? creative.originalFilePath
    if (!filePath) return Response.json({ error: 'No file available' }, { status: 404 })

    const exists = await storage.exists(filePath)
    if (!exists) return Response.json({ error: 'File not found in storage' }, { status: 404 })

    const buffer = await storage.read(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'mp4'
    const contentType = MIME[ext] ?? (creative.mediaType === 'image' ? 'image/jpeg' : 'video/mp4')
    const filename = `creative-${id}.${ext}`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    return Response.json({ error: 'Download failed', details: String(err) }, { status: 500 })
  }
}
