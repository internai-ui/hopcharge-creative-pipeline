/**
 * Turn a still image into an MP4 so it can be published where only video is accepted
 * (YouTube's videos.insert rejects non-video uploads outright - there is no "post a
 * photo" endpoint). The image is looped for a fixed duration and re-encoded to a
 * broadly-compatible H.264/yuv420p 9:16 file.
 *
 * A fully frozen frame reads as low-effort in the Shorts feed, so by default a gentle
 * Ken Burns zoom is baked in via ffmpeg's zoompan filter. The zoom is capped small
 * (see MAX_ZOOM) on purpose: the brand logo chip sits in a corner with only a 4%
 * margin (LOGO_OVERLAY_MARGIN_PCT) and is already baked into the flat image by the
 * time this runs, so a zoom that crops in more than that would clip it.
 *
 * Requires ffmpeg on PATH (override with FFMPEG_PATH). Unlike the logo overlay
 * helpers, there is no "fall back to the original" here - the original is a still
 * image and can't be uploaded as-is, so a failure here must throw.
 *
 * Toggles:
 *   YOUTUBE_STILL_KEN_BURNS=false     disable the pan/zoom, ship a static frame
 *   YOUTUBE_STILL_VIDEO_DURATION=8    seconds the image is held for (default 8)
 */

import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'

const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920
// Ceiling on the zoompan factor - stays inside the 4% logo margin (see file header).
const MAX_ZOOM = 1.06

export function kenBurnsEnabled(): boolean {
  return (process.env.YOUTUBE_STILL_KEN_BURNS ?? 'true').toLowerCase() !== 'false'
}

function durationSeconds(): number {
  const n = Number(process.env.YOUTUBE_STILL_VIDEO_DURATION ?? 8)
  return Number.isFinite(n) && n > 0 ? n : 8
}

/**
 * Encode a still image (png/jpg/webp) into a 9:16 H.264 mp4 of fixed duration.
 * Throws on failure - there is no still to fall back to once video is required.
 */
export async function stillToVideo(image: Buffer): Promise<Buffer> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hc-still2vid-'))
  try {
    const inPath = path.join(dir, 'in.img')
    const outPath = path.join(dir, 'out.mp4')
    await fsp.writeFile(inPath, image)

    const seconds = durationSeconds()
    const frames = Math.round(seconds * FPS)

    // Crop/scale to fill the 9:16 frame regardless of source aspect ratio, same as the
    // video pipeline's target canvas.
    const fillFrame = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`

    const vf = kenBurnsEnabled()
      ? // Upscale generously before zoompan (its own scaling is soft/blocky on a static
        // source) then pan/zoom up to MAX_ZOOM over the full duration.
        `${fillFrame},scale=${WIDTH * 4}:${HEIGHT * 4},` +
        `zoompan=z='min(zoom+${((MAX_ZOOM - 1) / frames).toFixed(6)},${MAX_ZOOM})':` +
        `d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`
      : `${fillFrame},fps=${FPS}`

    await run(
      FFMPEG,
      [
        '-y',
        '-loop', '1',
        '-i', inPath,
        '-t', String(seconds),
        '-vf', vf,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    )

    return await fsp.readFile(outPath)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
