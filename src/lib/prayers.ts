// Spoken prayers, kept only on this device. They live in their own IndexedDB
// database, apart from highlights and settings, so sync never sees them.
// The audio is stored as raw bytes with its type: older iPhones can't keep a
// Blob in IndexedDB.

export interface Prayer { id: string; at: number; ms: number; type: string; audio: ArrayBuffer }
export type PrayerInfo = Omit<Prayer, 'audio'>

const DB = 'plain-bible-prayers', STORE = 'prayers'
let db: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  return db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => { db = undefined; reject(r.error) }
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const s = (await open()).transaction(STORE, mode).objectStore(STORE)
  return new Promise((resolve, reject) => { const r = fn(s); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}

export const prayers = {
  /** Newest first, without the audio. */
  list: async (): Promise<PrayerInfo[]> => {
    const all = await tx<Prayer[]>('readonly', s => s.getAll())
    return all.map(({ audio: _, ...p }) => p).sort((a, b) => b.at - a.at)
  },
  get: (id: string) => tx<Prayer | undefined>('readonly', s => s.get(id)),
  put: (p: Prayer) => tx('readwrite', s => s.put(p)).then(() => {}),
  delete: (id: string) => tx('readwrite', s => s.delete(id)).then(() => {}),
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
