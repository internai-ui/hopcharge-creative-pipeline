// Upload a local image to Higgsfield storage and print the durable hosted URL to
// use as HIGGSFIELD_SARA_REFERENCE_URL (Soul image_reference) - works even though
// our storage is local MinIO, because Higgsfield hosts the file.
//
// FREE: this is a storage upload, not a generation - it does not consume credits.
//
//   npx tsx scripts/upload-higgsfield-reference.ts Sara/sara-2.png
import { config } from 'dotenv'
config({ path: '.env.local' })
import fs from 'fs'
import path from 'path'

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: npx tsx scripts/upload-higgsfield-reference.ts <path-to-image>')
    process.exit(1)
  }
  const ext = (file.split('.').pop() ?? '').toLowerCase()
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  const bytes = fs.readFileSync(path.resolve(file))

  const { uploadHiggsfieldImage } = await import('@/lib/plugins/higgsfield')
  const url = await uploadHiggsfieldImage(bytes, contentType)

  console.log(`Uploaded ${file} (${(bytes.length / 1e6).toFixed(1)} MB) - no credits used`)
  console.log('Hosted URL:', url)
  console.log('\nAdd to .env.local (then restart the dev server):')
  console.log('HIGGSFIELD_SARA_REFERENCE_URL=' + url)
}

main().catch((e) => { console.error('Upload failed:', String(e).slice(0, 400)); process.exit(1) })
