// Many people know a Bible we can't include, because it is still under
// copyright (NIV, NKJV, Segond 21...). This names, for some free versions
// here, the well-known ones they read most like, so a reader can find their
// way. Picked by translation style, never claiming to be the same text.
export const LIKE: Record<string, string> = {
  BSB: 'NIV, ESV, CSB',          // modern, close to the Hebrew and Greek
  UKJV: 'NKJV',                  // the King James with today's words
  BBE: 'NLT, GNT',               // plain everyday words
  LSG: 'Segond 21, Colombe',     // the Segond these are revisions of
  SpaRV: 'RVR 1960',             // the Reina-Valera it was revised from
}

// Also found by these names in a search, though not shown.
const ALSO: Record<string, string> = { BSB: 'NASB, NRSV, NET', UKJV: 'MEV, KJ21', BBE: 'NIrV, ERV, ICB', LSG: 'NEG, Segond', SpaRV: 'RVR, RVR1960, RVR 1995, RVA' }

/** True when `f` (lower case) is a name the version reads like, e.g. "niv" for the BSB. */
export function likeMatches(id: string, f: string): boolean {
  const names = `${LIKE[id] ?? ''}, ${ALSO[id] ?? ''}`.toLowerCase().split(/,\s*/).filter(Boolean)
  const g = f.trim()
  return !!g && names.some(n => n === g || n.replace(/\s/g, '') === g.replace(/\s/g, '') || (g.length >= 3 && n.startsWith(g)))
}
