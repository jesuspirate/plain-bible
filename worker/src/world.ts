// The prayer map's counting (see worldRoute in index.ts and src/world.tsx).

/** The country to count a prayer in, or nothing: only when the device says
 *  it prayed and counts on the map, and only a real country (not Tor's "T1"
 *  or the unknown "XX"). */
export function prayedIn(req: Request, q: URLSearchParams): string | undefined {
  if (q.get('pw') !== '1' || !(Number(q.get('pr')) > 0)) return
  const cc = (req as Request & { cf?: { country?: unknown } }).cf?.country
  return typeof cc === 'string' && /^[A-Z]{2}$/.test(cc) && cc !== 'XX' && cc !== 'T1' ? cc : undefined
}

// A country lights up on the prayer map once at least this many devices
// prayed there in the last 7 days, so one person alone in a small country
// never shows. The map only says which countries, never how many in each.
export const MAP_FLOOR = 5
export const MAP_DAYS = 7

/** The countries lit on the prayer map: those with MAP_FLOOR praying devices
 *  in the last MAP_DAYS days, from counts like 'prayedin:FR' per day. */
export function litCountries(rows: { kind: string; n: number }[]) {
  return rows.filter(r => r.n >= MAP_FLOOR).map(r => r.kind.slice('prayedin:'.length)).filter(c => /^[A-Z]{2}$/.test(c)).sort()
}
