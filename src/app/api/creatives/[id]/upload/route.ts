import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { overlayLogo, logoOverlayEnabled } from '@/lib/logo-overlay'
import { overlayLogoOnVideo, videoLogoOverlayEnabled } from '@/lib/video-logo-overlay'
import { overlayHeadline, headlineOverlayEnabled } from '@/lib/headline-overlay'
import { overlayHeadlineOnVideo, videoHeadlineOverlayEnabled } from '@/lib/video-headline-overlay'
import { NextRequest } from 'next/server'

// The uploaded File's name is unreliable - canvas/blob exports are often nameless
// or extension-less - so we derive the extension from the browser-reported MIME
// type first, and only fall back to the filename when the type is missing.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

const ALLOWED_EXTS = new Set(Object.values(MIME_TO_EXT))

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const creative = await prisma.creative.findUnique({ where: { id }, include: { idea: true } })
    if (!creative) return Response.json({ error: 'Creative not found' }, { status: 404 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const nameExt = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
    const ext = MIME_TO_EXT[file.type] ?? (ALLOWED_EXTS.has(nameExt) ? nameExt : '')
    if (!ext) {
      return Response.json(
        { error: `Unsupported file type: ${file.type || file.name || 'unknown'}` },
        { status: 415 },
      )
    }

    // Don't let a video land on an image creative (or vice-versa) - it would break
    // both display and publishing downstream.
    const uploadedKind = ext === 'mp4' || ext === 'webm' ? 'video' : 'image'
    if (creative.mediaType !== uploadedKind) {
      return Response.json(
        { error: `Creative expects ${creative.mediaType} but received a ${uploadedKind}` },
        { status: 422 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Manual-generation first upload: the creative has no media yet (it was parked in
    // `awaiting_upload` with only a prompt). This is the raw external-tool output, so
    // it hasn't been through the branding pass the automatic pipeline applies right
    // after generation (logo-overlay.ts / headline-overlay.ts) - apply both here,
    // same as generate-image/route.ts and poll-creative-status.ts do for API-generated
    // creatives, so a manually-uploaded ad isn't the only one that ships unbranded.
    if (creative.status === 'awaiting_upload') {
      const headline = creative.idea.headline
      let finalBuffer: Buffer = Buffer.from(buffer)
      if (uploadedKind === 'image') {
        if (logoOverlayEnabled()) finalBuffer = await overlayLogo(finalBuffer)
        if (headlineOverlayEnabled()) finalBuffer = await overlayHeadline(finalBuffer, headline)
      } else {
        if (videoLogoOverlayEnabled()) finalBuffer = await overlayLogoOnVideo(finalBuffer)
        if (videoHeadlineOverlayEnabled()) finalBuffer = await overlayHeadlineOnVideo(finalBuffer, headline)
      }

      const originalPath = `creatives/${id}/original.${ext}`
      await storage.save(originalPath, finalBuffer)
      if (creative.originalFilePath && creative.originalFilePath !== originalPath) {
        await storage.delete(creative.originalFilePath).catch(() => {})
      }
      const advanced = await prisma.creative.update({
        where: { id },
        data: { originalFilePath: originalPath, status: 'ready_for_review' },
      })
      return Response.json(advanced)
    }

    const filePath = `creatives/${id}/edited.${ext}`
    await storage.save(filePath, buffer)

    // A prior edit with a different extension would otherwise be orphaned in storage.
    if (creative.editedFilePath && creative.editedFilePath !== filePath) {
      await storage.delete(creative.editedFilePath).catch(() => {})
    }

    const updated = await prisma.creative.update({
      where: { id },
      data: { editedFilePath: filePath, isHumanEdited: true },
    })

    return Response.json(updated)
  } catch (err) {
    return Response.json({ error: 'Upload failed', details: String(err) }, { status: 500 })
  }
}
