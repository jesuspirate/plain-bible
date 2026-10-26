// A circle read like a journal, not a feed: what's new since you last
// looked first, then one group per day, and only a few days at a time, so
// it has an end.

export interface Day<T> { day: number | 'new'; items: T[] }

/** Local midnight of a time. */
export const dayOf = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime() }

/** Items in groups: the new ones (newest shared first), then by the day
 *  each belongs to (`at`; an old prayer shared today goes back to the day it
 *  was prayed). Whole days only, until at least `limit` items are shown;
 *  `more` says if days are left. */
export function byDay<T extends { id: string; at: number }>(items: T[], fresh: { has: (id: string) => boolean }, limit: number, at: (i: T) => number = i => i.at) {
  const days: Day<T>[] = []
  const news = items.filter(i => fresh.has(i.id)).sort((a, b) => b.at - a.at)
  if (news.length) days.push({ day: 'new', items: news })
  let n = news.length, more = false
  for (const i of items.filter(i => !fresh.has(i.id)).sort((a, b) => at(b) - at(a))) {
    const d = dayOf(at(i)), last = days[days.length - 1]
    if (last?.day === d) { last.items.push(i); n++; continue }
    if (n >= limit) { more = true; break }
    days.push({ day: d, items: [i] }); n++
  }
  return { days, more }
}
