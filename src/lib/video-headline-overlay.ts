/**
 * Composite the headline band onto a generated VIDEO with ffmpeg - the video
 * counterpart of headline-overlay.ts (which only handles stills). The same band PNG
 * is burned onto every frame, full-width, at the configured edge.
 *
 * Requires ffmpeg + ffprobe on PATH (override with FFMPEG_PATH / FFPROBE_PATH). If they
 * are missing, or anything fails, the ORIGINAL video is returned unchanged - the
 * overlay must never break creative generation.
 *
 * Toggle: HEADLINE_OVERLAY_VIDEO=false disables only the video overlay (images still
 * get their band); HEADLINE_OVERLAY_ENABLED=false disables both.
 */

import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp from 'sharp'
import { headlineOverlayEnabled, headlineConfig, renderHeadlineBand } from './headline-overlay'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'

export function videoHeadlineOverlayEnabled(): boolean {
  return headlineOverlayEnabled() && (process.env.HEADLINE_OVERLAY_VIDEO ?? 'true').toLowerCase() !== 'false'
}

async function probeDimensions(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await run(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      file,
    ])
    const s = (JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> })?.streams?.[0]
    if (s?.width && s?.height) return { width: s.width, height: s.height }
    return null
  } catch {
    return null
  }
}

/**
 * Return the video with the headline band burned into every frame at the configured
 * edge. Falls back to the original bytes on any failure.
 */
export async function overlayHeadlineOnVideo(video: Buffer, text: string): Promise<Buffer> {
  if (!text.trim()) return video
  let dir: string | null = null
  try {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hc-vidheadline-'))
    const inPath = path.join(dir, 'in.mp4')
    const bandImgPath = path.join(dir, 'band.png')
    const outPath = path.join(dir, 'out.mp4')
    await fsp.writeFile(inPath, video)

    const dims = await probeDimensions(inPath)
    if (!dims) {
      console.warn('[video-headline-overlay] Could not probe video dimensions (ffprobe missing?) - using original video')
      return video
    }

    const cfg = headlineConfig()
    const bandHeight = Math.round(dims.height * cfg.heightPct)
    const bandSvg = renderHeadlineBand(dims.width, bandHeight, text, cfg)
    const bandPng = await sharp(bandSvg).png().toBuffer()
    await fsp.writeFile(bandImgPath, bandPng)

    const top = cfg.position === 'top' ? 0 : dims.height - bandHeight

    await run(
      FFMPEG,
      [
        '-y',
        '-i', inPath,
        '-i', bandImgPath,
        '-filter_complex', `[0:v][1:v]overlay=0:${top}[v]`,
        '-map', '[v]',
        '-map', '0:a?',
        '-c:a', 'copy',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    )

    return await fsp.readFile(outPath)
  } catch (err) {
    console.warn('[video-headline-overlay] Failed to overlay headline band, using original video:', err)
    return video
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
