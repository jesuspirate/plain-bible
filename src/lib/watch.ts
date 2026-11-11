// Prayers from the Apple Watch. The watch app records a prayer and sends it
// to the iPhone app (ios/QuietBible/WatchInbox.swift), which holds it until
// this page takes it: kept with "Your prayers" like one recorded here, then
// the iPhone app's copy is deleted. Only in the App Store app; loaded lazily.

import type { Prayer } from './prayers'

/** What the iPhone app hands over: the audio is base64. */
export interface WatchPrayer { id: string; at: number; ms: number; type: string; audio: string }
/** The iPhone app's side: the oldest waiting prayer, and "I've kept it". */
export interface WatchBridge { next(): Promise<unknown>; done(id: string): Promise<unknown> }
/** Where prayers are kept here. */
export interface PrayerStore { get(id: string): Promise<Prayer | undefined>; put(p: Prayer): Promise<void> }

export const WATCH_EVENT = 'quietbible:watch'

type Handler = { postMessage(m: unknown): Promise<unknown> }
const handler = (): Handler | undefined => (globalThis as { webkit?: { messageHandlers?: { watch?: Handler } } }).webkit?.messageHandlers?.watch

/** The bridge, where the iPhone app has one. */
export function watchBridge(h = handler()): WatchBridge | undefined {
  return h && { next: () => h.postMessage({ op: 'next' }), done: id => h.postMessage({ op: 'done', id }) }
}

function bytes(base64: string): ArrayBuffer {
  const s = atob(base64), out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out.buffer
}

const valid = (p: unknown): p is WatchPrayer => {
  const w = p as WatchPrayer
  return !!w && typeof w.id === 'string' && /^[a-z0-9]{1,40}$/i.test(w.id) && Number.isFinite(w.at) && w.at > 0 &&
    Number.isFinite(w.ms) && w.ms > 0 && typeof w.type === 'string' && typeof w.audio === 'string' && w.audio.length > 0
}

/** Take every waiting prayer. Resolves the start times of those kept.
 *  A prayer is only let go of over there once it is safely kept here; one
 *  already here (the "done" never arrived) is not kept twice. */
export async function takeWatchPrayers(bridge: WatchBridge, store: PrayerStore): Promise<number[]> {
  const kept: number[] = []
  // A bound, in case the other side never lets go.
  for (let i = 0, last = ''; i < 500; i++) {
    const p = await bridge.next()
    if (!valid(p) || p.id === last) break
    last = p.id
    if (!await store.get(p.id)) {
      let audio: ArrayBuffer
      try { audio = bytes(p.audio) } catch { await bridge.done(p.id); continue }
      await store.put({ id: p.id, at: p.at, ms: p.ms, type: p.type, audio })
      kept.push(p.at)
    }
    await bridge.done(p.id)
  }
  return kept
}

let running: Promise<void> | undefined
/** Bring in the watch's prayers; they count as days of prayer, and sync like the rest. */
export function fromWatch(): Promise<void> {
  const bridge = watchBridge()
  if (!bridge) return Promise.resolve()
  return running ??= (async () => {
    const [{ prayers }, { dayOf, markDay, PRAY }] = await Promise.all([import('./prayers'), import('./streaks')])
    const kept = await takeWatchPrayers(bridge, prayers)
    if (!kept.length) return
    for (const at of kept) markDay(PRAY, dayOf(at))
    navigator.storage?.persist?.().catch(() => {})
    dispatchEvent(new Event(WATCH_EVENT + ':kept'))
    try { if (localStorage.getItem('plain-bible:prayer-sync')) await (await import('./prayerSync')).syncPrayers() } catch { /* next time */ }
  })().catch(() => {}).finally(() => { running = undefined })
}
