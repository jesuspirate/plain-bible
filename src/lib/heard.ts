// What was listened to on this device since the last daily hello (see
// hello.ts), told with it and then started again: whether Listen (picked
// verses) or Read along was used, with what voice (a recording's narrator,
// the phone's own voice, or none), in which Bible and in which language. Only
// which ones, never how often, how long, or which verses.
const KEY = 'plain-bible:heard'
export const HEARD_KINDS = ['m', 's', 'b', 'l'] as const
type Kind = typeof HEARD_KINDS[number]
/** m: listen | along. s: voice | silent | a recording's id. b: Bible id. l: language. */
export type Heard = Partial<Record<Kind, string[]>>

const ok = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(x)

export function heardSince(): Heard {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>
    return Object.fromEntries(HEARD_KINDS.flatMap(k => {
      const list = Array.isArray(h[k]) ? (h[k] as unknown[]).filter(ok) : []
      return list.length ? [[k, [...new Set(list)].slice(0, 12)]] : []
    }))
  } catch { return {} }
}
const save = (h: Heard) => { try { localStorage.setItem(KEY, JSON.stringify(h)) } catch { /* private mode */ } }

/** Something started playing (or reading along with no voice). */
export function heard(mode: 'listen' | 'along', source: string, bible: string, lang: string) {
  const h = heardSince(), add: Record<Kind, string> = { m: mode, s: source, b: bible, l: lang }
  let changed = false
  for (const k of HEARD_KINDS) {
    if (!ok(add[k]) || h[k]?.includes(add[k])) continue
    h[k] = [...(h[k] ?? []), add[k]]; changed = true
  }
  if (changed) save(h)
}

/** Told: take off what was sent, keeping what was heard since. */
export function unheard(sent: Heard) {
  const h = heardSince()
  for (const k of HEARD_KINDS) {
    const left = (h[k] ?? []).filter(x => !sent[k]?.includes(x))
    if (left.length) h[k] = left; else delete h[k]
  }
  save(h)
}
