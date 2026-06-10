import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { NextRequest } from 'next/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const creative = await prisma.creative.findUnique({ where: { id } })
    if (!creative) return Response.json({ error: 'Creative not found' }, { status: 404 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.name.split('.').pop() ?? 'mp4'
    const filePath = `creatives/${id}/edited.${ext}`
    await storage.save(filePath, buffer)

    const updated = await prisma.creative.update({
      where: { id },
      data: { editedFilePath: filePath, isHumanEdited: true },
    })

    return Response.json(updated)
  } catch (err) {
    return Response.json({ error: 'Upload failed', details: String(err) }, { status: 500 })
  }
}
