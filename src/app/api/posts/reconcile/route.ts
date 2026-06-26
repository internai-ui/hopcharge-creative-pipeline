import { reconcilePosts } from '@/lib/jobs/reconcile-posts'

// Reconcile published Meta posts against Ads Manager and mark any deleted ads.
export async function POST() {
  try {
    const result = await reconcilePosts()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json({ error: 'Reconcile failed', details: String(err) }, { status: 500 })
  }
}
