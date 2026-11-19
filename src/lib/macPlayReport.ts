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
    box.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;max-width:min(640px,90vw);max-height:90vh;overflow:hidden;margin:0;padding:8px 10px;background:#fff;color:#000;font:12px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;border:2px solid #b00;border-radius:8px;pointer-events:none'
    document.body.appendChild(box)
  }
  box.textContent = [`Quiet Bible play report (web ${__BUILD__}) ${status}`, ...lines].join('\n')
  clearTimeout(hide)
  hide = window.setTimeout(() => { box?.remove(); box = null }, 120_000)
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

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const typeOf = (name: string) => name.endsWith('wav') ? 'audio/wav' : name.endsWith('mp3') ? 'audio/mpeg' : 'audio/mp4'

/** Loads `src` in a muted player: metadata, an error, or nothing in 3 s. */
function load(src: string): Promise<string> {
  return new Promise(done => {
    const a = new Audio(); a.muted = true; a.preload = 'auto'
    const end = (s: string) => { done(s); a.removeAttribute('src'); a.load() }
    a.addEventListener('loadedmetadata', () => end(`ok, ${a.duration.toFixed(2)} s`), { once: true })
    a.addEventListener('error', () => end(`error ${a.error?.code} ${a.error?.message}`), { once: true })
    setTimeout(() => end(`nothing in 3 s (${state(a)})`), 3000)
    a.src = src; a.load()
  })
}

function decode(buf: ArrayBuffer): Promise<string> {
  const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new C()
  return Promise.race([
    ctx.decodeAudioData(buf.slice(0)).then(b => `ok, ${b.duration.toFixed(2)} s`, e => `failed ${e?.name} ${e?.message}`),
    wait(3000).then(() => 'nothing in 3 s'),
  ]).finally(() => ctx.close().catch(() => {}))
}

const dataUrl = (bytes: Uint8Array, type: string) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(bin)}`
}

/** In the Mac app, instead of playing: tries each way of playing, one at a
 *  time, writing what it is about to try first, so if the page freezes the
 *  last line names the culprit. The last step plays the prayer for real.
 *  Returns false outside the Mac app (play as usual). */
export function macPlayWatch(el: HTMLAudioElement, raw: ArrayBuffer, fixed: ArrayBuffer | Uint8Array, type: string, url: string): boolean {
  if (!inMacApp()) return false
  const bytes = fixed instanceof Uint8Array ? fixed : new Uint8Array(fixed)
  const head = (u: Uint8Array) => Array.from(u.subarray(4, 8)).map(c => String.fromCharCode(c)).join('')
  note(`prayer: ${type}, stored ${raw.byteLength} bytes, played ${bytes.length} bytes (${head(bytes)})`)
  const start = performance.now()
  const alive = setInterval(() => { status = `alive ${Math.round((performance.now() - start) / 1000)} s`; show() }, 1000)
  const step = async (what: string, run: () => Promise<string>) => {
    note(`trying ${what}…`); await wait(300)
    note(`  ${what}: ${await run()}`)
  }
  ;(async () => {
    const base = `${import.meta.env.BASE_URL}diag/`
    const get = (n: string) => fetch(base + n).then(r => r.arrayBuffer())
    await step('tone.m4a by address', () => load(base + 'tone.m4a'))
    await step('tone.mp3 by address', () => load(base + 'tone.mp3'))
    await step('tone.wav decode', async () => decode(await get('tone.wav')))
    await step('tone.m4a decode', async () => decode(await get('tone.m4a')))
    await step('iphone.m4a decode', async () => decode(await get('iphone.m4a')))
    await step('prayer decode', () => decode(bytes.slice().buffer))
    await step('tone.m4a as data:', async () => load(dataUrl(new Uint8Array(await get('tone.m4a')), 'audio/mp4')))
    await step('prayer as data:', async () => load(dataUrl(bytes, type)))
    await step('tone.m4a from memory (blob)', async () => load(URL.createObjectURL(new Blob([await get('tone.m4a')], { type: 'audio/mp4' }))))
    await step('prayer from memory (blob)', () => load(url))
    await step('prayer, playing aloud (blob)', () => new Promise(done => {
      el.addEventListener('playing', () => done('playing'), { once: true })
      el.addEventListener('error', () => done(`error ${el.error?.code} ${el.error?.message}`), { once: true })
      setTimeout(() => done(`nothing in 3 s (${state(el)})`), 3000)
      el.src = url
      el.play().catch(e => done(`play() refused: ${e?.name} ${e?.message}`))
    }))
    note('done')
    clearInterval(alive); status = 'done'; show()
  })()
  return true
}

let status = ''

export const macPlayNote = (s: string) => { if (inMacApp()) note(s) }
