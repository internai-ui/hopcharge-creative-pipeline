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

    const version = new URL(_req.url).searchParams.get('version')
    const filePath = version === 'original'
      ? creative.originalFilePath
      : (creative.editedFilePath ?? creative.originalFilePath)
    if (!filePath) return Response.json({ error: 'No file available' }, { status: 404 })

    // When the backend can mint a temporary URL (S3/R2), redirect the browser
    // straight to it: bandwidth bypasses this server, and the rotating signed URL
    // means a re-uploaded edit is never served from a stale cache. `no-store`
    // keeps the *redirect itself* from being cached.
    const signedUrl = await storage.getSignedUrl(filePath)
    if (signedUrl) {
      return new Response(null, {
        status: 307,
        headers: { Location: signedUrl, 'Cache-Control': 'no-store' },
      })
    }

    // Local-disk fallback: stream the bytes ourselves.
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
        // Was `immutable, max-age=1yr`, which made re-uploaded edits invisible.
        // Force revalidation so fresh uploads always show.
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err) {
    return Response.json({ error: 'Download failed', details: String(err) }, { status: 500 })
  }
}
