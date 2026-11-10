// What you keep about a prayer besides its recording and verses, and how
// the list of prayers is laid out once there are many of them.
import { dayOf } from './streaks'
import { N_ } from '../i18n'

/** `fav`: starred. `name`, `topic`, `answered` (when): yours to fill in. */
export interface Journal { fav?: boolean; name?: string; topic?: string; answered?: number }

/** A journal as it came back from storage or another device: only what's
 *  set, and nothing oversized. */
export function cleanJournal(v: unknown): Journal {
  const x = (v && typeof v === 'object' ? v : {}) as Journal, out: Journal = {}
  if (x.fav === true) out.fav = true
  const name = typeof x.name === 'string' ? x.name.trim().slice(0, 80) : ''
  if (name) out.name = name
  const topic = typeof x.topic === 'string' ? x.topic.trim().slice(0, 40) : ''
  if (topic) out.topic = topic
  if (typeof x.answered === 'number' && Number.isFinite(x.answered) && x.answered > 0) out.answered = x.answered
  return out
}
export const sameJournal = (a: Journal, b: Journal) => JSON.stringify(cleanJournal(a)) === JSON.stringify(cleanJournal(b))

/** Prayers (newest first) for the list: this month's under their days, and
 *  each earlier month as one group, so a long history stays short. */
export function byMonth<T extends { at: number }>(list: T[], now: number | Date = Date.now()) {
  const month = (t: number | Date) => dayOf(t).slice(0, 7), current = month(now)
  const days: { day: string; list: T[] }[] = [], months: { month: string; list: T[] }[] = []
  for (const p of list) {
    const m = month(p.at)
    if (m >= current) {
      const d = dayOf(p.at), last = days[days.length - 1]
      if (last?.day === d) last.list.push(p); else days.push({ day: d, list: [p] })
    } else {
      const last = months[months.length - 1]
      if (last?.month === m) last.list.push(p); else months.push({ month: m, list: [p] })
    }
  }
  return { days, months }
}

/** Lower case, accents off, punctuation to spaces: "Éph. 6:18" finds "eph 6 18". */
export const foldFind = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Whether every word typed is in what a prayer shows (its verses, its date,
 *  its name and topic), as the start of a word: "nov 7", "psalm 23". */
export function finds(typed: string, shown: string[]) {
  const hay = ' ' + foldFind(shown.join(' '))
  return foldFind(typed).split(' ').every(w => hay.includes(' ' + w))
}

/** 54 min, 1 h 29: how long a group of prayers lasts. */
export function longDuration(ms: number) {
  const m = Math.max(1, Math.round(ms / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** Topics offered before you make your own. Kept under these English names,
 *  and shown in the app's language. */
export const TOPICS = [N_('Thanks'), N_('Family'), N_('Healing'), N_('Guidance'), N_('Church')]

/** The topics to choose from: the ones offered, then your own, in the order
 *  they were first used (`list` is newest first). */
export function topicsOf(list: { topic?: string }[]) {
  const own = [...list].reverse().map(p => p.topic).filter((x): x is string => !!x && !TOPICS.includes(x))
  return [...TOPICS, ...new Set(own)]
}
