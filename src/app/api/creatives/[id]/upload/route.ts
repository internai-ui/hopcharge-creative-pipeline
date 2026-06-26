import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
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
    const creative = await prisma.creative.findUnique({ where: { id } })
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
