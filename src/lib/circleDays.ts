// A circle read like a journal, not a feed: what's new since you last
// looked first, then one group per day, and only a few days at a time, so
// it has an end.

export interface Day<T> { day: number | 'new'; items: T[] }

/** Local midnight of a time. */
export const dayOf = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime() }

/** Items (newest first) in groups: the new ones, then by day. Whole days
 *  only, until at least `limit` items are shown; `more` says if days are left. */
export function byDay<T extends { id: string; at: number }>(items: T[], fresh: { has: (id: string) => boolean }, limit: number) {
  const days: Day<T>[] = []
  const news = items.filter(i => fresh.has(i.id))
  if (news.length) days.push({ day: 'new', items: news })
  let n = news.length, more = false
  for (const i of items) {
    if (fresh.has(i.id)) continue
    const d = dayOf(i.at), last = days[days.length - 1]
    if (last?.day === d) { last.items.push(i); n++; continue }
    if (n >= limit) { more = true; break }
    days.push({ day: d, items: [i] }); n++
  }
  return { days, more }
}
