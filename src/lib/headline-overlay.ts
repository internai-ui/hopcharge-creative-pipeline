/**
 * Composite a headline text banner onto a generated IMAGE - a solid brand-colour band
 * with the idea's headline set into it, so the ad carries its own message instead of
 * relying on the platform's separate ad-copy field. Diffusion models render in-frame
 * text as garbled mush (same reason the logo is stamped in post, see logo-overlay.ts),
 * so the band + type are drawn here with real, controllable typography instead of
 * being prompted for.
 *
 * The band sits in the TOP ~quarter of the frame by default, not the bottom - Reels/
 * Shorts native UI (caption, username, engagement icons) already claims the bottom and
 * right edges, so a bottom band would fight the platform chrome. The image prompt
 * (see prompt-constants.ts TEXT_SAFE_ZONE_GUARDRAIL) asks the model to keep that same
 * region visually calm so the band reads as a designed part of the shot, not a sticker
 * slapped over the subject's face.
 *
 * All knobs are env-configurable:
 *   HEADLINE_OVERLAY_ENABLED     "false" to skip entirely              (default on)
 *   HEADLINE_OVERLAY_POSITION    top|bottom                            (default top)
 *   HEADLINE_OVERLAY_HEIGHT_PCT  band height as % of frame height      (default 24)
 *   HEADLINE_OVERLAY_BG          band background colour                (default #222E53, the real logo navy)
 *   HEADLINE_OVERLAY_ACCENT      thin divider rule colour              (default #D9A441, the van's gold stripe)
 *   HEADLINE_OVERLAY_TEXT_COLOR  headline text colour                  (default #FFFFFF)
 *   HEADLINE_OVERLAY_FONT        font-family                           (default "Lato, DejaVu Sans, sans-serif")
 *
 * The chip-rendering helpers are shared with the video overlay (video-headline-overlay.ts).
 */

import sharp from 'sharp'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type BandPosition = 'top' | 'bottom'

export interface HeadlineConfig {
  position: BandPosition
  heightPct: number
  bg: string
  accent: string
  textColor: string
  font: string
}

export function headlineOverlayEnabled(): boolean {
  return (process.env.HEADLINE_OVERLAY_ENABLED ?? 'true').toLowerCase() !== 'false'
}

export function headlineConfig(): HeadlineConfig {
  return {
    position: (process.env.HEADLINE_OVERLAY_POSITION ?? 'top') as BandPosition,
    heightPct: clamp(Number(process.env.HEADLINE_OVERLAY_HEIGHT_PCT ?? 24), 10, 40) / 100,
    bg: process.env.HEADLINE_OVERLAY_BG ?? '#222E53',
    accent: process.env.HEADLINE_OVERLAY_ACCENT ?? '#D9A441',
    textColor: process.env.HEADLINE_OVERLAY_TEXT_COLOR ?? '#FFFFFF',
    font: process.env.HEADLINE_OVERLAY_FONT ?? 'Lato, DejaVu Sans, sans-serif',
  }
}

// Rough glyph-width heuristic (bold sans averages ~0.56x font-size per character) -
// there's no text-measuring lib in the stack, and headlines are short marketing
// lines, not paragraphs, so "good enough to wrap sanely" beats pulling in a new dep.
const AVG_CHAR_WIDTH = 0.56

function wrapLines(text: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/)
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * AVG_CHAR_WIDTH)))
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
    if (lines.length === maxLines - 1 && current.length > maxChars) {
      // Last allowed line - stop accumulating more words than fit, ellipsis the rest.
      break
    }
  }
  if (current) lines.push(current)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…')
  } else if (lines.length === maxLines) {
    const consumedWords = lines.join(' ').split(/\s+/).length
    if (consumedWords < words.length) {
      lines[maxLines - 1] = `${lines[maxLines - 1]}…`
    }
  }
  return lines
}

/**
 * Render the headline band as a standalone PNG at the given frame width/height -
 * shared by the image and video overlay paths.
 */
export function renderHeadlineBand(
  width: number,
  bandHeight: number,
  text: string,
  cfg: HeadlineConfig = headlineConfig(),
): Buffer {
  const paddingX = Math.round(width * 0.08)
  const maxTextWidth = width - paddingX * 2
  const maxLines = 3

  let fontSize = Math.round(bandHeight * 0.28)
  let lines = wrapLines(text, fontSize, maxTextWidth, maxLines)
  // Shrink once if the wrap still produced more lines than comfortably fit the band.
  const lineHeight = 1.18
  while (lines.length * fontSize * lineHeight > bandHeight * 0.72 && fontSize > 18) {
    fontSize = Math.round(fontSize * 0.85)
    lines = wrapLines(text, fontSize, maxTextWidth, maxLines)
  }

  const blockHeight = lines.length * fontSize * lineHeight
  const startY = (bandHeight - blockHeight) / 2 + fontSize * 0.85
  const accentH = Math.max(2, Math.round(bandHeight * 0.018))
  const accentY = cfg.position === 'top' ? bandHeight - accentH : 0

  const tspans = lines
    .map((line, i) => `<tspan x="50%" y="${startY + i * fontSize * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('')

  const svg =
    `<svg width="${width}" height="${bandHeight}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${width}" height="${bandHeight}" fill="${cfg.bg}"/>` +
    `<rect x="0" y="${accentY}" width="${width}" height="${accentH}" fill="${cfg.accent}"/>` +
    `<text font-family="${cfg.font}" font-weight="700" font-size="${fontSize}" fill="${cfg.textColor}" ` +
    `text-anchor="middle" letter-spacing="0.2">${tspans}</text>` +
    `</svg>`

  return Buffer.from(svg)
}

/**
 * Return the image with a headline band composited in. On any failure the ORIGINAL
 * buffer is returned - the banner must never break creative generation.
 */
export async function overlayHeadline(image: Buffer, text: string): Promise<Buffer> {
  if (!text.trim()) return image
  try {
    const cfg = headlineConfig()
    const meta = await sharp(image).metadata()
    const W = meta.width ?? 1080
    const H = meta.height ?? 1920
    const bandHeight = Math.round(H * cfg.heightPct)
    const bandSvg = renderHeadlineBand(W, bandHeight, text, cfg)
    const bandPng = await sharp(bandSvg).png().toBuffer()
    const top = cfg.position === 'top' ? 0 : H - bandHeight
    return await sharp(image).composite([{ input: bandPng, left: 0, top }]).toBuffer()
  } catch (err) {
    console.warn('[headline-overlay] Failed to composite headline band, using original image:', err)
    return image
  }
}
