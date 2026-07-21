import { prisma } from '@/lib/db'
import { recommendSchedule } from '@/lib/schedule-recommender'
import { NextRequest } from 'next/server'

// GET [?creativeId=...] → a day-parting recommendation. With a creativeId, the ad's
// own copy is scanned for a time-of-day daypart and blended with the account's
// historical CPL-by-time; without it, the recommendation is account-wide.
export async function GET(req: NextRequest) {
  try {
    const creativeId = new URL(req.url).searchParams.get('creativeId')
    let adText: string | undefined
    if (creativeId) {
      const creative = await prisma.creative.findUnique({
        where: { id: creativeId },
        include: { idea: true },
      })
      const i = creative?.idea
      if (i) {
        adText = [i.hook, i.imageVisual, i.videoVisual, i.primaryText, i.headline, i.cta]
          .filter(Boolean)
          .join(' . ')
      }
    }
    const rec = await recommendSchedule({ adText })
    return Response.json(rec)
  } catch (err) {
    return Response.json({ error: 'Failed to compute schedule recommendation', details: String(err) }, { status: 500 })
  }
}
