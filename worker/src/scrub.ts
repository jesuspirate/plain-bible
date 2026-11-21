// What a problem report may say about where someone was in the app, without
// what the address carries. A link can hold a secret (a circle invite's key,
// a device link's key) and a search holds the words typed, so only the path
// and a few plain values are kept; anything else is shown as …
//
// Used twice on purpose: by the app before a report leaves the device, and
// by the sync service before it writes the email, so a report from an older
// app (which sent whole addresses) is cleaned too.

/** Query values that only say where: verse, end verse, Bibles, scope, book. */
const KEEP = new Set(['v', 'e', 'at', 'p', 'b', 's'])
/** A part of an address long enough to be an id or a key, not a word. */
const TOKEN = /[A-Za-z0-9_-]{20,}/
/** Anywhere else in a line (a key in an error, a key shown on screen): a
 *  long run with a digit in it. */
const TOKENS = /[A-Za-z0-9_+/=-]{24,}/g
const hidden = (m: string) => /\d/.test(m) ? '…' : m

/** An in-app address (#/…) with nothing secret or typed left in it. */
export function screenOf(hash: string): string {
  const [path, query] = hash.replace(/^#\/?/, '').split('?', 2)
  const parts = path.split('/').filter(Boolean)
  // A device link is nothing but its secret.
  const kept = parts[0] === 'move' ? ['move', '…'] : parts.map(p => TOKEN.test(p) || /%/.test(p) ? '…' : p)
  const params = (query ?? '').split('&').filter(Boolean).map(pair => {
    const [k, v = ''] = pair.split('=', 2)
    return KEEP.has(k) && /^[\w,.:-]{0,40}$/.test(v) && !TOKEN.test(v) ? `${k}=${v}` : `${k.replace(/[^\w-]/g, '').slice(0, 12)}=…`
  })
  return ('#/' + kept.join('/') + (params.length ? '?' + params.join('&') : '')).slice(0, 120)
}

/** Any line of a report (a step, an error): addresses cleaned, long keys hidden. */
export function scrub(s: string): string {
  return s
    // A web address keeps its site and path, never its query or what follows #.
    .replace(/\bhttps?:\/\/[^\s?#"'<>]*([?#][^\s"'<>]*)?/gi, (all, rest: string | undefined) => {
      const base = all.slice(0, all.length - (rest?.length ?? 0))
      if (!rest) return base
      const hash = rest.indexOf('#/')
      return base + (rest.startsWith('?') ? '?…' : '') + (hash >= 0 ? screenOf(rest.slice(hash)) : rest.includes('#') ? '#…' : '')
    })
    .replace(/(^|[^\w/.:])#\/[^\s"'<>]*/g, (all, before: string) => before + screenOf(all.slice(before.length)))
    .replace(TOKENS, hidden)
}

/** The words on a thing someone tapped: also never a one-time code shown big
 *  on screen (4+ digits in a row, spaced or not). */
export const scrubLabel = (s: string) => scrub(s).replace(/\d(?:[\s\u00a0]?\d){3,}/g, '…')
/** A recorded step: cleaned, and the tapped thing's “words” as a label. */
export const scrubStep = (s: string) => scrub(s).replace(/“[^”]*”/g, scrubLabel)
