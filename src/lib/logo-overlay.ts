/**
 * Composite the REAL Hopcharge logo onto a generated image.
 *
 * Diffusion models render brand text as garbled, inconsistent logos. So the van is
 * described UNBRANDED in the prompt (no wordmark on the panels, see VAN_A_BRIEF) and the
 * image prompt forbids in-frame logos/text (IMAGE_POSITIVE_GUARDRAILS); we then stamp the
 * authentic asset here, in post - consistent every time.
 *
 * The logo is placed on a semi-opaque white "chip" so it stays legible over any
 * background (the brand asset is dark navy and would vanish on dark scenes). All
 * knobs are env-configurable:
 *   LOGO_OVERLAY_ENABLED     "false" to skip entirely            (default on)
 *   LOGO_OVERLAY_PATH        path to logo (svg/png)              (default public/hopcharge-logo.svg)
 *   LOGO_OVERLAY_CORNER      top-left|top-right|bottom-left|bottom-right (default bottom-right)
 *   LOGO_OVERLAY_WIDTH_PCT   logo width as % of image width      (default 22)
 *   LOGO_OVERLAY_MARGIN_PCT  margin as % of the shorter side     (default 4)
 *   LOGO_OVERLAY_OPACITY     chip opacity 0.1–1                  (default 0.9)
 *   LOGO_OVERLAY_CHIP        "false" to drop the white chip      (default on)
 *
 * The chip-rendering and placement helpers are shared with the video overlay
 * (src/lib/video-logo-overlay.ts).
 */

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const logoPath = () =>
  process.env.LOGO_OVERLAY_PATH ?? path.join(process.cwd(), 'public', 'hopcharge-logo.svg')

export function logoOverlayEnabled(): boolean {
  return (process.env.LOGO_OVERLAY_ENABLED ?? 'true').toLowerCase() !== 'false'
}

export interface LogoConfig {
  corner: Corner
  widthPct: number  // logo width as a fraction of the frame width
  marginPct: number // margin as a fraction of the shorter side
  opacity: number
  withChip: boolean
}

export function logoConfig(): LogoConfig {
  return {
    corner: (process.env.LOGO_OVERLAY_CORNER ?? 'bottom-right') as Corner,
    widthPct: clamp(Number(process.env.LOGO_OVERLAY_WIDTH_PCT ?? 22), 5, 60) / 100,
    marginPct: clamp(Number(process.env.LOGO_OVERLAY_MARGIN_PCT ?? 4), 0, 25) / 100,
    opacity: clamp(Number(process.env.LOGO_OVERLAY_OPACITY ?? 0.9), 0.1, 1),
    withChip: (process.env.LOGO_OVERLAY_CHIP ?? 'true').toLowerCase() !== 'false',
  }
}

/** Top-left pixel position of a (markW x markH) mark in a (W x H) frame, per config. */
export function markPosition(
  W: number,
  H: number,
  markW: number,
  markH: number,
  cfg: LogoConfig = logoConfig(),
): { left: number; top: number } {
  const margin = Math.round(Math.min(W, H) * cfg.marginPct)
  const left = cfg.corner.includes('left') ? margin : W - markW - margin
  const top = cfg.corner.includes('top') ? margin : H - markH - margin
  return { left: clamp(left, 0, Math.max(0, W - markW)), top: clamp(top, 0, Math.max(0, H - markH)) }
}

let cachedLogo: Buffer | null = null
function loadLogo(): Buffer | null {
  if (cachedLogo) return cachedLogo
  const p = logoPath()
  if (!fs.existsSync(p)) return null
  cachedLogo = fs.readFileSync(p)
  return cachedLogo
}

/**
 * Render the brand mark - the logo, optionally centred on a white chip - as a PNG at the
 * target width. Returns null if the logo asset is missing. Shared by image + video.
 */
export async function renderLogoMark(
  logoWidthPx: number,
  cfg: LogoConfig = logoConfig(),
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  const logoSrc = loadLogo()
  if (!logoSrc) {
    console.warn(`[logo-overlay] Logo not found at ${logoPath()} - skipping overlay`)
    return null
  }
  const logoW = Math.max(1, Math.round(logoWidthPx))
  // density boosts SVG crispness at the target raster size
  const logoBuf = await sharp(logoSrc, { density: 300 }).resize({ width: logoW }).png().toBuffer()
  const logoH = (await sharp(logoBuf).metadata()).height ?? Math.round(logoW * 0.16)

  if (!cfg.withChip) return { buffer: logoBuf, width: logoW, height: logoH }

  const pad = Math.round(logoW * 0.08)
  const markW = logoW + pad * 2
  const markH = logoH + pad * 2
  const radius = Math.round(pad * 0.8)
  const chip = Buffer.from(
    `<svg width="${markW}" height="${markH}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${markW}" height="${markH}" rx="${radius}" ry="${radius}" ` +
      `fill="#ffffff" fill-opacity="${cfg.opacity}"/></svg>`,
  )
  const buffer = await sharp(chip).composite([{ input: logoBuf, left: pad, top: pad }]).png().toBuffer()
  return { buffer, width: markW, height: markH }
}

/**
 * Return the image with the Hopcharge logo composited in. On any failure the ORIGINAL
 * buffer is returned - overlaying the brand mark must never break creative generation.
 */
export async function overlayLogo(image: Buffer): Promise<Buffer> {
  try {
    const cfg = logoConfig()
    const meta = await sharp(image).metadata()
    const W = meta.width ?? 1080
    const H = meta.height ?? 1920
    const mark = await renderLogoMark(Math.round(W * cfg.widthPct), cfg)
    if (!mark) return image
    const { left, top } = markPosition(W, H, mark.width, mark.height, cfg)
    return await sharp(image).composite([{ input: mark.buffer, left, top }]).toBuffer()
  } catch (err) {
    console.warn('[logo-overlay] Failed to composite logo, using original image:', err)
    return image
  }
}
