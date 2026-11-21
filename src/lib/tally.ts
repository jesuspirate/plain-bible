// A few running counts on this device, told to the service with the next
// daily hello (see hello.ts) and then started again: prayers recorded,
// chapters read, verses shared and bookmarks saved. Just numbers, never
// which prayer, chapter, verse or bookmark.
const KEY = 'plain-bible:tally'
export const TALLY_KINDS = ['pr', 'ch', 'sh', 'bm'] as const
export type TallyKind = typeof TALLY_KINDS[number]
export type Tally = Partial<Record<TallyKind, number>>

export function tallies(): Tally {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>
    return Object.fromEntries(TALLY_KINDS.flatMap(k => typeof t[k] === 'number' && (t[k] as number) > 0 ? [[k, Math.floor(t[k] as number)]] : []))
  } catch { return {} }
}
const save = (t: Tally) => { try { localStorage.setItem(KEY, JSON.stringify(t)) } catch { /* private mode */ } }

/** One more of something. */
export function tally(kind: TallyKind, n = 1) {
  const t = tallies()
  save({ ...t, [kind]: (t[kind] ?? 0) + n })
}

/** Told: take what was sent off, keeping what happened since. */
export function untally(sent: Tally) {
  const t = tallies()
  for (const k of TALLY_KINDS) if (sent[k]) t[k] = Math.max(0, (t[k] ?? 0) - sent[k]!)
  save(t)
}
