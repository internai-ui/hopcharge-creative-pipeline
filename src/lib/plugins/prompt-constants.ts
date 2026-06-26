/**
 * Shared prompt engineering constants for all Hopcharge generators.
 *
 * Van designs (from actual Hopcharge fleet photography):
 *
 * VAN_A - Primary van (Maruti Suzuki Eeco-style micro cargo van):
 *   Compact Indian micro cargo van (~3.6m long). White painted metal body on the
 *   front cabin and lower panels. Royal blue vinyl wrap covering the upper rear
 *   cargo section (rear ~60% of body above the gold stripe). Bright gold/amber
 *   horizontal accent stripe running the full length of the lower body. Blue panel
 *   carries: "hopcharge™" wordmark in white, the Hopcharge EV-charging icon, and a
 *   line-art illustration of a sedan with a charging plug. Sliding side door; when
 *   open reveals internal charging equipment. A thick black rubber charging hose
 *   (~5 cm diameter, 3–4 m long) runs from the open side door or body port to the
 *   customer's EV charge port.
 *
 * VAN_B - Secondary / newer van (large cube battery box truck):
 *   Light commercial truck chassis (Tata Ace-style) with a large standalone white
 *   rectangular battery box body (~1.8m × 1.8m × 2m) on the rear bed. White
 *   panels edged with red border trim and bright yellow corner accent pieces.
 *   "wherever you go - power follows" + "hopcharge™" + "TATA EV" co-branding on
 *   the panels. Rear double metal doors open to reveal the battery unit; a thick
 *   black charging cable exits and connects to the customer's EV. Yellow Hopcharge
 *   caution A-frame sign placed nearby during service.
 */

// ── Van description strings ──────────────────────────────────────────────────

/** Full van description for API prompts (no character limit) */
export const VAN_A_FULL =
  'compact Maruti Suzuki Eeco-style white Indian micro cargo van - white front cabin, ' +
  'royal blue vinyl wrap on the upper rear cargo section, bright gold/amber horizontal accent stripe ' +
  'along the full lower body, "hopcharge™" wordmark and EV-charging icon printed on the blue panel, ' +
  'sliding side door open revealing internal charging equipment, thick black rubber charging cable ' +
  '(~5 cm diameter) running from the van to the EV charge port'

export const VAN_B_FULL =
  'white cube-shaped mobile battery box on a light truck chassis - large rectangular white box body ' +
  'with red border trim on all panel edges and bright yellow corner accents, "hopcharge™" and ' +
  '"TATA EV" co-branding on the white panels, rear double doors open, thick black charging cable ' +
  'running from the box to the customer\'s EV'

/** Compact van description for browser prompts (character-budget ~120 chars) */
export const VAN_A_BRIEF =
  'white Maruti Eeco cargo van, royal blue rear wrap, gold horizontal stripe, hopcharge logo, thick charging cable to EV'

export const VAN_B_BRIEF =
  'white cube battery box truck, red trim, yellow corners, hopcharge branding, thick charging cable to EV'

// ── Setting string ────────────────────────────────────────────────────────────

export const INDIA_SETTING_FULL =
  'upscale gated residential colony or premium office campus in Gurugram or Noida - ' +
  'paver-block or polished concrete surface, manicured landscaping, modern glass-and-steel towers visible, ' +
  'clean wide access roads'

export const INDIA_SETTING_BRIEF =
  'upscale Gurugram apartment complex or office campus, modern glass towers, clean paver surface'

// ── Sara - recurring customer character (see /Sara/sara-description.md) ──────
//
// Sara is the customer in every Hopcharge ad. All customer-facing visuals use her.
// The technician / van operator is a background character and does NOT need to be Sara.

export const CHARACTER_FULL =
  'Sara - Indian woman, mid-to-late 20s, warm wheatish complexion with golden undertone, ' +
  'round soft face with full cheeks, large expressive almond-shaped dark brown eyes, ' +
  'naturally arched dark eyebrows, full lips with a warm genuine smile, ' +
  'long extremely thick voluminous near-black hair with natural loose waves falling to mid-back - her most distinctive feature, ' +
  'athletic-curvy build approximately 165 cm tall, confident upright posture, ' +
  'minimal warm-toned makeup, small hoop earrings - ' +
  'she is the EV owner being served, calm and unhurried, not looking at camera'

export const CHARACTER_BRIEF =
  'Indian woman late 20s, warm brown skin, round face full cheeks, large dark eyes, ' +
  'very long thick dark wavy hair to mid-back, athletic build, warm genuine smile'

// ── Negative prompts ─────────────────────────────────────────────────────────

export const NEGATIVE_VIDEO =
  'blurry, shaky cam, handheld wobble, low resolution, grainy, compression artefacts, ' +
  'watermark, text overlay, subtitles, burnt-in captions, logo stamp, ' +
  'overexposed, underexposed, blown highlights, washed-out colours, ' +
  'cartoon, CGI, animation, illustrated, drawn, ' +
  'petrol pump, gas station, fuel nozzle, ' +
  'Western suburb, European street, American city, non-Indian architecture, ' +
  'generic white van (no branding), wrong van colour, red or green van, ' +
  'distorted faces, extra fingers, anatomical errors, ' +
  'AI glitch artefacts, morphing faces, flickering textures'

export const NEGATIVE_IMAGE =
  'blurry, out of focus, low resolution, noisy, grainy, JPEG artefacts, ' +
  'watermark, text overlay, speech bubble, caption burned into image, ' +
  'overexposed, blown out sky, dark silhouette, flat lighting, ' +
  'cartoon, illustration, painting, digital art, 3D render, ' +
  'petrol pump, gas station, ' +
  'Western suburb, European street, non-Indian city, ' +
  'wrong van colour, generic van, no Hopcharge branding, ' +
  'distorted hands, extra fingers, uncanny faces, ' +
  'stock photo feel, fake smile, posed stiffness'

// ── Quality / style suffixes ─────────────────────────────────────────────────

export const VIDEO_QUALITY =
  'Cinematic colour grade - warm golden-teal contrast. Shallow depth of field. ' +
  'Smooth stabilised camera movement. High production value. 9:16 vertical format.'

export const IMAGE_QUALITY =
  'Shot on Sony A7 IV, 50 mm f/1.8, shallow depth of field. ' +
  'Natural cinematic colour grade, warm sidelight. High-end advertising photography. ' +
  '9:16 vertical crop, no text overlay, no watermark.'

// ── Builder functions ─────────────────────────────────────────────────────────

interface BuildVideoOptions {
  /** Use compact descriptions to stay within browser character budgets (~800 chars) */
  brief?: boolean
  /** Which van design to feature */
  van?: 'A' | 'B'
}

/**
 * Builds a full video prompt by combining the idea's videoVisual with
 * structured context, van description, setting, and quality markers.
 *
 * Prompt structure follows the SCENE → SUBJECT → VEHICLE → SETTING → CAMERA → MOOD → TECHNICAL
 * framework for maximum consistency across generators.
 */
export function buildVideoPrompt(videoVisual: string, options: BuildVideoOptions = {}): string {
  const { brief = false, van = 'A' } = options
  // videoVisual already carries the full shot list, camera moves, setting, lighting
  // and mood. Append only a concise brand anchor (the van livery the model must get
  // right) + the technical/format suffix - no duplicated, conflicting direction.
  const vanDesc = van === 'A' ? VAN_A_BRIEF : VAN_B_BRIEF
  return [
    videoVisual,
    `Hopcharge van (render livery exactly): ${vanDesc}.`,
    brief ? 'Cinematic, smooth stabilised camera, golden-hour grade, 9:16 vertical.' : VIDEO_QUALITY,
  ].join(' ')
}

/**
 * Fallback for ideas that have no dedicated videoFirstFrame: derive an opening-frame
 * still prompt from the first beat of videoVisual (the "OPENING SHOT 0-3s …" segment
 * before the first beat arrow). Used so the video pipeline always has a first frame.
 */
export function deriveFirstFrameVisual(videoVisual: string): string {
  const firstBeat = (videoVisual.split('→')[0] ?? videoVisual).trim()
  const cleaned = firstBeat.replace(/^OPENING SHOT\s*\d*\s*-?\s*\d*\s*s?\s*/i, '').trim()
  return cleaned || videoVisual.trim()
}

interface BuildImageOptions {
  brief?: boolean
  van?: 'A' | 'B'
  angle?: string
}

/**
 * Builds a full image prompt for Flux / Flyne using the idea's imageVisual
 * with structured composition, lighting, and brand context.
 *
 * Follows the SUBJECT → COMPOSITION → SETTING → LIGHTING → MOOD → TECHNICAL framework.
 */
export function buildImagePrompt(imageVisual: string, options: BuildImageOptions = {}): string {
  const { brief = false, van = 'A' } = options
  // imageVisual already specifies the subject, composition, setting, lighting and
  // mood. Append only the van brand anchor + technical/format suffix.
  const vanDesc = van === 'A' ? VAN_A_BRIEF : VAN_B_BRIEF
  return [
    imageVisual,
    `Hopcharge van (render livery exactly): ${vanDesc}.`,
    brief ? 'Advertising photo, 9:16 vertical, no text overlay.' : IMAGE_QUALITY,
  ].join(' ')
}
