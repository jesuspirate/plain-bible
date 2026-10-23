// Spoken prayers, kept only on this device. They live in their own IndexedDB
// database, apart from highlights and settings, so sync never sees them.
// The audio is stored as raw bytes with its type: older iPhones can't keep a
// Blob in IndexedDB.

/** One stretch of recording. */
export interface Part { ms: number; type: string; audio: ArrayBuffer }
/** A prayer: its first part, plus any parts added after it was interrupted
 *  (the phone locked) and picked up again. `ms` is the length of them all. */
export interface Prayer extends Part { id: string; at: number; more?: Part[] }
/** A prayer without its audio; `parts` counts its parts. */
export type PrayerInfo = Omit<Prayer, 'audio' | 'more'> & { parts: number }

/** The prayer with `part` added on the end. */
export const withPart = (p: Prayer, part: Part): Prayer => ({ ...p, ms: p.ms + part.ms, more: [...(p.more ?? []), part] })
/** Every part, in order. */
export const partsOf = (p: Prayer): Part[] => [{ ms: p.more ? p.ms - p.more.reduce((n, x) => n + x.ms, 0) : p.ms, type: p.type, audio: p.audio }, ...(p.more ?? [])]

// `meta` holds the sync state: the prayer key and deletions not yet sent.
const DB = 'plain-bible-prayers', STORE = 'prayers', META = 'meta'
let db: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  return db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2)
    r.onupgradeneeded = e => {
      if (e.oldVersion < 1) r.result.createObjectStore(STORE, { keyPath: 'id' })
      if (e.oldVersion < 2) r.result.createObjectStore(META)
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => { db = undefined; reject(r.error) }
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const s = (await open()).transaction(store, mode).objectStore(store)
  return new Promise((resolve, reject) => { const r = fn(s); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}

export const prayers = {
  /** Newest first, without the audio. */
  list: async (): Promise<PrayerInfo[]> => {
    const all = await tx<Prayer[]>('readonly', s => s.getAll())
    return all.map(({ audio: _, more, ...p }) => ({ ...p, parts: 1 + (more?.length ?? 0) })).sort((a, b) => b.at - a.at)
  },
  get: (id: string) => tx<Prayer | undefined>('readonly', s => s.get(id)),
  put: (p: Prayer) => tx('readwrite', s => s.put(p)).then(() => {}),
  /** Add a part to a prayer that was interrupted. */
  append: async (id: string, part: Part) => {
    const p = await prayers.get(id)
    if (!p) throw new Error('gone')
    await prayers.put(withPart(p, part))
  },
  delete: (id: string) => tx('readwrite', s => s.delete(id)).then(() => {}),
}

export const meta = {
  get: <T>(k: string) => tx<T | undefined>('readonly', s => s.get(k), META),
  set: (k: string, v: unknown) => (v === undefined ? tx('readwrite', s => s.delete(k), META) : tx('readwrite', s => s.put(v, k), META)).then(() => {}),
}

/** The first audio format this browser can record. iPhones record AAC in
 *  MP4; most others Opus in WebM. MP4 comes first because every browser can
 *  play it back, should prayers ever move between devices. */
export function recordingType(can: (t: string) => boolean = t => MediaRecorder.isTypeSupported(t)) {
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => { try { return can(t) } catch { return false } }) ?? ''
}

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** 1:05, 12:30 */
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
