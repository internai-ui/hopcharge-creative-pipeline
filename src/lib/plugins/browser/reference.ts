/**
 * Resolve a first-frame reference image to a local file path the browser automations
 * can upload via Playwright's setInputFiles (image-to-video). Feeding an approved
 * first frame is what preserves Sara / brand consistency on the free browser video
 * path - text-to-video alone re-invents the scene each run.
 */

import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import crypto from 'crypto'

const IMAGE_DIR = path.join(process.cwd(), 'storage', 'browser-images')
const REF_DIR = path.join(process.cwd(), 'storage', 'browser-refs')

function downloadTo(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http
    client
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          return downloadTo(res.headers.location!, dest).then(resolve).catch(reject)
        }
        if (!res.statusCode || res.statusCode >= 400) {
          file.close()
          return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`))
        }
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
      })
      .on('error', (e) => { fs.unlink(dest, () => {}); reject(e) })
  })
}

/**
 * Turn a reference-image ref into an absolute local file path, or null if it can't be
 * resolved (caller then falls back to text-to-video). Accepts:
 *  - a local served path  (/api/browser-images/<file>)  -> storage/browser-images/<file>
 *  - an absolute file path (already on disk)             -> returned as-is
 *  - a remote http(s) URL  (CDN / placeholder)           -> downloaded to storage/browser-refs
 */
export async function resolveReferenceToLocalPath(ref: string): Promise<string | null> {
  try {
    if (!ref) return null

    if (ref.startsWith('/api/browser-images/')) {
      const p = path.join(IMAGE_DIR, ref.replace('/api/browser-images/', ''))
      return fs.existsSync(p) ? p : null
    }

    if (path.isAbsolute(ref) && fs.existsSync(ref)) return ref

    if (ref.startsWith('http://') || ref.startsWith('https://')) {
      fs.mkdirSync(REF_DIR, { recursive: true })
      const ext = ref.split('?')[0].match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase() ?? 'jpg'
      // Deterministic filename (no Date/random) so the same ref maps to one cached file.
      const name = crypto.createHash('sha1').update(ref).digest('hex').slice(0, 16)
      const dest = path.join(REF_DIR, `${name}.${ext}`)
      if (!fs.existsSync(dest)) await downloadTo(ref, dest)
      return fs.existsSync(dest) ? dest : null
    }

    return null
  } catch {
    return null
  }
}
