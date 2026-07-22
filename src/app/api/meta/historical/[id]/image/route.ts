import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { NextRequest } from 'next/server'

const MIME: Record<string, string> = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  mp4:  'video/mp4',
  webm: 'video/webm',
}

// Serve the stored creative (still or, for a Meta video ad with a real source file,
// the actual video) for a historical imported ad - see POST /api/ads/import-creatives.
// Used as the thumbnail/inline preview in the Publish page's "Imported ads" lists.
// Mirrors the creative download route: redirect to a signed S3 URL when available,
// otherwise stream the bytes.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ad = await prisma.historicalAd.findUnique({ where: { id }, select: { creativeImagePath: true } })
    const filePath = ad?.creativeImagePath
    if (!filePath) return Response.json({ error: 'No image available' }, { status: 404 })

    const signedUrl = await storage.getSignedUrl(filePath)
    if (signedUrl) {
      return new Response(null, { status: 307, headers: { Location: signedUrl, 'Cache-Control': 'no-store' } })
    }

    const exists = await storage.exists(filePath)
    if (!exists) return Response.json({ error: 'File not found in storage' }, { status: 404 })

    const buffer = await storage.read(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg'
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': MIME[ext] ?? 'image/jpeg', 'Cache-Control': 'no-cache' },
    })
  } catch (err) {
    return Response.json({ error: 'Image failed', details: String(err) }, { status: 500 })
  }
}
