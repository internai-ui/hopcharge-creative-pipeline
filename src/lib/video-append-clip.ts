/**
 * Append a fixed outro clip (public/hopcharge_logo_clip.mp4 by default) to the end of a
 * generated VIDEO with ffmpeg, run AFTER the logo/headline overlays (video-logo-overlay.ts,
 * video-headline-overlay.ts) so the headline band is never burned onto the outro - the
 * outro is its own branded moment, not another frame to caption.
 *
 * The clip is scaled/padded (letterboxed, not stretched) to match the main video's
 * resolution and frame rate, and both segments are normalized to a real audio track
 * (silence synthesized for whichever side lacks one) before concatenation - the
 * concat filter requires matching stream layouts, and source videos/outro may differ
 * in aspect ratio or have no audio at all.
 *
 * Requires ffmpeg + ffprobe on PATH (override with FFMPEG_PATH / FFPROBE_PATH). If they,
 * or the clip asset, are missing, or anything fails, the ORIGINAL video is returned
 * unchanged - the outro must never break creative generation.
 *
 * Toggles:
 *   OUTRO_CLIP_ENABLED=false   skip appending the outro entirely   (default on)
 *   OUTRO_CLIP_PATH            path to the outro mp4               (default public/hopcharge_logo_clip.mp4)
 */

import fsp from 'fs/promises'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'

const clipPath = () =>
  process.env.OUTRO_CLIP_PATH ?? path.join(process.cwd(), 'public', 'hopcharge_logo_clip.mp4')

export function outroClipEnabled(): boolean {
  return (process.env.OUTRO_CLIP_ENABLED ?? 'true').toLowerCase() !== 'false'
}

interface VideoInfo {
  width: number
  height: number
  fps: string
  hasAudio: boolean
  duration: number
}

async function probeVideo(file: string): Promise<VideoInfo | null> {
  try {
    const { stdout } = await run(FFPROBE, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration',
      '-of', 'json',
      file,
    ])
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string }>
      format?: { duration?: string }
    }
    const streams = parsed.streams ?? []
    const v = streams.find((s) => s.codec_type === 'video')
    const hasAudio = streams.some((s) => s.codec_type === 'audio')
    const duration = Number(parsed.format?.duration)
    if (!v?.width || !v?.height || !Number.isFinite(duration)) return null
    return { width: v.width, height: v.height, fps: v.r_frame_rate || '30/1', hasAudio, duration }
  } catch {
    return null
  }
}

/**
 * Return the video with the outro clip appended after it. Falls back to the original
 * bytes on any failure (missing ffmpeg, probe/encode error, missing clip asset).
 */
export async function appendOutroClip(video: Buffer): Promise<Buffer> {
  const clip = clipPath()
  if (!fs.existsSync(clip)) {
    console.warn(`[video-append-clip] Outro clip not found at ${clip} - skipping`)
    return video
  }

  let dir: string | null = null
  try {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hc-vidoutro-'))
    const mainPath = path.join(dir, 'main.mp4')
    const outPath = path.join(dir, 'out.mp4')
    await fsp.writeFile(mainPath, video)

    const [mainInfo, clipInfo] = await Promise.all([probeVideo(mainPath), probeVideo(clip)])
    if (!mainInfo || !clipInfo) {
      console.warn('[video-append-clip] Could not probe video(s) (ffprobe missing?) - using original video')
      return video
    }

    const { width: W, height: H, fps } = mainInfo
    const scalePad =
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`
    const silence = (duration: number) =>
      `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${duration},asetpts=PTS-STARTPTS`

    const filterParts = [
      `[0:v]${scalePad}[v0]`,
      `[1:v]${scalePad}[v1]`,
      mainInfo.hasAudio
        ? `[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a0]`
        : `${silence(mainInfo.duration)}[a0]`,
      clipInfo.hasAudio
        ? `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a1]`
        : `${silence(clipInfo.duration)}[a1]`,
      `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
    ]

    await run(
      FFMPEG,
      [
        '-y',
        '-i', mainPath,
        '-i', clip,
        '-filter_complex', filterParts.join(';'),
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    )

    return await fsp.readFile(outPath)
  } catch (err) {
    console.warn('[video-append-clip] Failed to append outro clip, using original video:', err)
    return video
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
