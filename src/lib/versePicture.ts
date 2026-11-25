// A verse as a picture, drawn on the device: the words, the reference, the
// Bible's name and the app's lamp, in the reader's own look (light, dark or
// sepia). No server, nothing to download: the fonts are already here, so it
// works offline. Shared as a photo, so Facebook (or Instagram, Messages…)
// shows the whole verse, not a link card.

export const PICTURE_W = 1080
export const PICTURE_H = 1350 // 4:5, the tallest a Facebook or Instagram feed shows whole

type Look = { bg: string; text: string; muted: string; accent: string; line: string }
const LOOKS: Record<'light' | 'sepia' | 'dark', Look> = {
  light: { bg: '#faf8f3', text: '#22211f', muted: '#6b675f', accent: '#7a4b1e', line: '#e4dfd4' },
  sepia: { bg: '#f4ecd8', text: '#3b2f22', muted: '#7a6a55', accent: '#7a4b1e', line: '#e0d3b6' },
  dark: { bg: '#16161a', text: '#e6e3dc', muted: '#9a958b', accent: '#e0a96d', line: '#2f2f36' },
}

/** The look on screen now ('system' follows the phone). */
export function lookNow(): keyof typeof LOOKS {
  const th = document.documentElement.dataset.theme
  if (th === 'sepia' || th === 'dark' || th === 'light') return th
  return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// The app's lamp (public/icon.svg), drawn on a 512 square.
const FLAME = 'M272.1 72C264.9 115.2 303.8 144 321 180C336.9 213.1 332.6 256.3 306.6 280.8C292.2 295.2 276.4 302.4 257.7 302.4C217.4 302.4 191.4 272.2 191.4 236.2C191.4 201.6 213 177.1 231.8 157C251.9 135.4 269.2 110.9 272.1 72Z'
const WICK = 'M264.9 185.8C270.6 210.2 290.8 223.2 290.8 249.1C290.8 269.3 276.4 283.7 257.7 283.7C239 283.7 224.6 269.3 224.6 250.6C224.6 226.1 249 213.1 264.9 185.8Z'
const BOWL = 'M104 326H408C408 390 340 436 256 436C172 436 104 390 104 326Z'

type Measure = (s: string) => number

/** Breaks `text` into lines no wider than `w`: at spaces, or anywhere in
 *  words too long for a line (Chinese, Japanese and Thai have no spaces). */
export function wrap(measure: Measure, text: string, w: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + word : word
    if (measure(next) <= w) { line = next; continue }
    if (line) lines.push(line)
    line = ''
    if (measure(word) <= w) { line = word; continue }
    for (const ch of word) {
      if (line && measure(line + ch) > w) { lines.push(line); line = '' }
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

/** The biggest size (`max` down to `min`) at which the words fit `room`; at
 *  the smallest, lines past the room are left out and the last ends with "…". */
export function fit(measureAt: (size: number) => Measure, text: string, w: number, room: (size: number) => number, max = 120, min = 30) {
  let size = max, lines: string[] = []
  for (; size >= min; size -= 2) {
    lines = wrap(measureAt(size), text, w)
    if (lines.length * size * 1.42 <= room(size)) return { size, lines }
  }
  size = min
  const most = Math.max(1, Math.floor(room(size) / (size * 1.42)))
  if (lines.length > most) {
    lines = lines.slice(0, most)
    lines[most - 1] = lines[most - 1].replace(/[\s,;:.]+$/, '') + '…'
  }
  return { size, lines }
}

export type Picture = { words: string; reference: string; bible: string; rtl?: boolean; look?: keyof typeof LOOKS
  /** Wide (1200×630), for a shared link's card, instead of tall (1080×1350) for a post. */
  wide?: boolean }

// Where everything goes: tall for a photo post, wide for a link's card.
const TALL = { W: PICTURE_W, H: PICTURE_H, inset: 40, radius: 36, top: 100, foot: 250, side: 120, max: 120, min: 30,
  ref: 46, refGap: 70, ver: 30, verGap: 118, under: 130, fy: 150, ic: 64, name: 34, addr: 28, addrGap: 66, brandTop: false }
// The wide one carries the lamp and name on TOP: X lays the page title
// across the bottom of a link's picture and would hide them there, so the
// bottom is left quiet (everything ends above X's strip).
export const WIDE = { W: 1200, H: 630, inset: 22, radius: 28, top: 108, foot: 118, side: 90, max: 76, min: 22,
  ref: 32, refGap: 46, ver: 22, verGap: 78, under: 88, fy: 568, ic: 38, name: 23, addr: 19, addrGap: 36, brandTop: true }

/** Draws the picture; resolves to a PNG. */
export async function drawPicture(p: Picture): Promise<Blob> {
  const look = LOOKS[p.look ?? lookNow()]
  const css = getComputedStyle(document.documentElement)
  const serif = css.getPropertyValue('--reading').trim().startsWith('var(')
    ? css.getPropertyValue('--serif').trim() : css.getPropertyValue('--reading').trim()
  const reading = serif || 'Georgia, serif'
  const sans = css.getPropertyValue('--sans').trim() || 'system-ui, sans-serif'
  // The fonts are on the device; make sure they're loaded before drawing.
  await Promise.all([`400 60px ${reading}`, `700 40px ${sans}`, `500 30px ${sans}`]
    .map(f => document.fonts?.load(f, p.words + p.reference).catch(() => {})))

  const L = p.wide ? WIDE : TALL, W = L.W, H = L.H
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const x = canvas.getContext('2d')!
  x.direction = p.rtl ? 'rtl' : 'ltr'
  x.fillStyle = look.bg; x.fillRect(0, 0, W, H)
  // A quiet frame.
  x.strokeStyle = look.line; x.lineWidth = 3
  x.beginPath(); roundRect(x, L.inset, L.inset, W - 2 * L.inset, H - 2 * L.inset, L.radius); x.stroke()

  // The words, as big as they fit between the top and the lamp, with the
  // quote mark above them and the reference below.
  const top = L.top, bottom = H - L.foot, maxW = W - 2 * L.side
  const measureAt = (size: number): Measure => { x.font = `400 ${size}px ${reading}`; return s => x.measureText(s).width }
  const { size, lines } = fit(measureAt, p.words, maxW, s => bottom - top - s * 1.3 - L.under, L.max, L.min)
  const lh = size * 1.42, block = lines.length * lh
  const ys = top + (bottom - top - (size * 1.3 + block + L.under)) / 2, y0 = ys + size * 1.3
  x.textAlign = 'center'; x.textBaseline = 'alphabetic'
  x.fillStyle = look.accent; x.globalAlpha = .55
  x.font = `700 ${Math.round(size * 1.6)}px ${reading}`
  x.fillText(p.rtl ? '”' : '“', W / 2, ys + size * 1.45)
  x.globalAlpha = 1
  x.fillStyle = look.text; x.font = `400 ${size}px ${reading}`
  lines.forEach((l, i) => x.fillText(l, W / 2, y0 + lh * i + size))
  x.fillStyle = look.accent; x.font = `700 ${L.ref}px ${sans}`
  x.fillText(p.reference, W / 2, y0 + block + L.refGap, maxW)
  x.fillStyle = look.muted; x.font = `500 ${L.ver}px ${sans}`
  x.fillText(p.bible, W / 2, y0 + block + L.verGap, maxW)

  // The lamp, the app's name and its address: under the words on the tall
  // picture, on one line at the top of the wide one.
  const fy = H - L.fy, ic = L.ic, addr = 'myquietbible.com', gap = ic * .9
  x.font = `700 ${L.name}px ${sans}`
  const name = 'My Quiet Bible', nw = x.measureText(name).width
  x.font = `500 ${L.addr}px ${sans}`
  const aw = L.brandTop ? x.measureText(addr).width + gap : 0
  const sx = (W - ic - ic * .3 - nw - aw) / 2
  x.save(); x.translate(sx, fy - ic / 2); x.scale(ic / 512, ic / 512)
  x.fillStyle = '#22211f'; x.beginPath(); roundRect(x, 0, 0, 512, 512, 114); x.fill()
  x.fillStyle = '#e0a96d'; x.fill(new Path2D(FLAME))
  x.fillStyle = '#22211f'; x.fill(new Path2D(WICK))
  x.fillStyle = '#f4ecd8'; x.fill(new Path2D(BOWL))
  x.restore()
  x.direction = 'ltr'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = look.text
  x.font = `700 ${L.name}px ${sans}`
  x.fillText(name, sx + ic * 1.3, fy + 2)
  x.fillStyle = look.muted; x.font = `500 ${L.addr}px ${sans}`
  if (L.brandTop) x.fillText(addr, sx + ic * 1.3 + nw + gap, fy + 2)
  else { x.textAlign = 'center'; x.fillText(addr, W / 2, fy + L.addrGap) }

  return new Promise((ok, no) => canvas.toBlob(b => b ? ok(b) : no(new Error('no picture')), 'image/png'))
}

// Older Safari (before 16) has no roundRect.
function roundRect(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  if (x.roundRect) { x.roundRect(l, t, w, h, r); return }
  x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r)
  x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath()
}

/** "John 3:16 (KJV)" → "John-3-16-KJV.png" */
export function pictureName(reference: string) {
  return (reference.replace(/[\s:–—,()]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'verse') + '.png'
}

/** Shares the picture through the phone's share sheet, if this browser can
 *  share pictures. Call it straight from the tap (the file must be ready). */
export function canSharePicture(file: File) {
  try { return !!navigator.canShare?.({ files: [file] }) } catch { return false }
}

/** A phone or tablet (touch first). Only there does the share sheet list
 *  Facebook, X and WhatsApp; a Mac's or computer's has none of them, so
 *  there the buttons open the apps' websites with a link, as before. */
export function sheetHasApps() {
  try { return matchMedia('(pointer: coarse)').matches } catch { return false }
}
