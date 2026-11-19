// TEMPORARY (Mac app only): why prayers don't play on a Mac.
// Each tap on a prayer's play button first copies the report of the
// previous try to the clipboard (a tap may write the clipboard; a timer
// may not), then starts a new one. Remove once the cause is known.
import { inMacApp } from './install'

let lines: string[] = []
let t0 = 0
const note = (s: string) => { lines.push(`${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${s}`); show() }

// Also on screen (top left, can't be clicked), for 60 s after the last line:
// a clipboard write can fail without a word.
let box: HTMLPreElement | null = null
let hide = 0
function show() {
  if (!box) {
    box = document.createElement('pre')
    box.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;max-width:min(640px,90vw);max-height:80vh;overflow:hidden;margin:0;padding:8px 10px;background:#fff;color:#000;font:12px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;border:2px solid #b00;border-radius:8px;pointer-events:none'
    document.body.appendChild(box)
  }
  box.textContent = [`Quiet Bible play report (web ${__BUILD__})`, ...lines].join('\n')
  clearTimeout(hide)
  hide = window.setTimeout(() => { box?.remove(); box = null }, 60_000)
}

export function macPlayTap() {
  if (!inMacApp()) return
  if (lines.length) {
    const text = ['Quiet Bible play report', ...lines].join('\n')
    try { navigator.clipboard?.writeText(text).catch(() => copyOld(text)) } catch { copyOld(text) }
  }
  lines = []; t0 = performance.now()
}

function copyOld(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
  document.body.appendChild(ta); ta.select()
  try { document.execCommand('copy') } catch { /* nothing more to try */ }
  ta.remove()
}

const state = (a: HTMLAudioElement) =>
  `ready ${a.readyState}, net ${a.networkState}, at ${a.currentTime.toFixed(2)}, dur ${a.duration}, paused ${a.paused}` +
  (a.error ? `, error ${a.error.code} ${a.error.message}` : '')

/** Watches the real player, and tries two other ways to play the same sound
 *  (silently) to see which one a Mac takes. */
export function macPlayWatch(el: HTMLAudioElement, raw: ArrayBuffer, fixed: ArrayBuffer | Uint8Array, type: string, url: string) {
  if (!inMacApp()) return
  const head = (b: ArrayBuffer | Uint8Array) => {
    const u = b instanceof Uint8Array ? b : new Uint8Array(b)
    return Array.from(u.subarray(4, 8)).map(c => String.fromCharCode(c)).join('')
  }
  note(`type ${type}, stored ${raw.byteLength} bytes (${head(raw)}), played ${fixed.byteLength} bytes (${head(fixed)}), ${url.slice(0, 5)}`)
  note(`page: ${document.documentElement.className}`)
  for (const e of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'stalled', 'suspend', 'waiting', 'error', 'ended', 'pause'])
    el.addEventListener(e, () => note(`player ${e}: ${state(el)}`))
  setTimeout(() => note(`player +3 s: ${state(el)}`), 3000)

  // 2. The same bytes as a data: address, muted.
  const bytes = fixed instanceof Uint8Array ? fixed : new Uint8Array(fixed)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const d = new Audio()
  d.muted = true; d.preload = 'auto'
  d.addEventListener('loadedmetadata', () => note(`data: loaded, dur ${d.duration}`))
  d.addEventListener('error', () => note(`data: error ${d.error?.code} ${d.error?.message}`))
  d.src = `data:${type};base64,${btoa(bin)}`
  d.load()
  setTimeout(() => { note(`data: +3 s: ${state(d)}`); d.removeAttribute('src'); d.load() }, 3000)

  // 3. Web Audio decoding.
  try {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new C()
    note(`audio context: ${ctx.state}, ${ctx.sampleRate} Hz`)
    ctx.decodeAudioData(bytes.slice().buffer).then(
      b => note(`decoded: ${b.duration.toFixed(2)} s, ${b.numberOfChannels} ch`),
      e => note(`decode failed: ${e?.name} ${e?.message}`),
    ).finally(() => ctx.close().catch(() => {}))
  } catch (e) { note(`no audio context: ${(e as Error)?.message}`) }
}

export const macPlayNote = (s: string) => { if (inMacApp()) note(s) }
