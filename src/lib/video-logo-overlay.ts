/**
 * Composite the real Hopcharge logo onto a generated VIDEO with ffmpeg - the video
 * counterpart of logo-overlay.ts (which only handles stills). The van is rendered
 * unbranded in the prompt, so this stamps the authentic, consistent mark on every frame.
 *
 * Requires ffmpeg + ffprobe on PATH (override with FFMPEG_PATH / FFPROBE_PATH). If they
 * are missing, or anything fails, the ORIGINAL video is returned unchanged - the overlay
 * must never break creative generation. Position/size/opacity reuse the same
 * LOGO_OVERLAY_* knobs as the image overlay.
 *
 * Toggles:
 *   LOGO_OVERLAY_ENABLED=false   disables BOTH image and video overlays
 *   LOGO_OVERLAY_VIDEO=false     disables only the video overlay
 */

import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { logoOverlayEnabled, logoConfig, renderLogoMark, markPosition } from './logo-overlay'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'

export function videoLogoOverlayEnabled(): boolean {
  return logoOverlayEnabled() && (process.env.LOGO_OVERLAY_VIDEO ?? 'true').toLowerCase() !== 'false'
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
 * Return the video with the Hopcharge logo burned into every frame at the configured
 * corner. Falls back to the original bytes on any failure (missing ffmpeg, probe/encode
 * error, missing logo asset).
 */
export async function overlayLogoOnVideo(video: Buffer): Promise<Buffer> {
  let dir: string | null = null
  try {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hc-vidlogo-'))
    const inPath = path.join(dir, 'in.mp4')
    const logoImgPath = path.join(dir, 'logo.png')
    const outPath = path.join(dir, 'out.mp4')
    await fsp.writeFile(inPath, video)

    const dims = await probeDimensions(inPath)
    if (!dims) {
      console.warn('[video-logo-overlay] Could not probe video dimensions (ffprobe missing?) - using original video')
      return video
    }

    const cfg = logoConfig()
    const mark = await renderLogoMark(Math.round(dims.width * cfg.widthPct), cfg)
    if (!mark) return video
    await fsp.writeFile(logoImgPath, mark.buffer)

    const { left, top } = markPosition(dims.width, dims.height, mark.width, mark.height, cfg)

    // Overlay the chip PNG onto the video; keep audio if present (-map 0:a?), re-encode
    // video (overlay requires it) to a broadly-compatible H.264/yuv420p mp4 for Meta.
    await run(
      FFMPEG,
      [
        '-y',
        '-i', inPath,
        '-i', logoImgPath,
        '-filter_complex', `[0:v][1:v]overlay=${left}:${top}[v]`,
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
    console.warn('[video-logo-overlay] Failed to overlay logo, using original video:', err)
    return video
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
