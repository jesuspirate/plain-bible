// The last few errors the app ran into, kept in memory only (gone on
// reload), so a problem report can say what broke. Never sent on its own:
// only with a report the person writes and sends, which says so.
const MAX = 5
const seen: string[] = []

export function noteError(what: unknown) {
  const e = what as { message?: string; stack?: string } | undefined
  let line = String(e?.message ?? what ?? '').trim()
  // The first place in the code, so the line points somewhere.
  const at = /\n\s*at .*?([\w.-]+\.(?:js|tsx?)):(\d+)/.exec(e?.stack ?? '') ?? /@.*?([\w.-]+\.(?:js|tsx?)):(\d+)/.exec(e?.stack ?? '')
  if (at) line += ` (${at[1]}:${at[2]})`
  line = line.slice(0, 200)
  if (!line || seen[seen.length - 1] === line) return
  seen.push(line)
  if (seen.length > MAX) seen.shift()
}
export const recentErrors = () => [...seen]

/** Started once, at launch. */
export function watchErrors() {
  addEventListener('error', e => noteError(e.error ?? e.message))
  addEventListener('unhandledrejection', e => noteError(e.reason))
}
