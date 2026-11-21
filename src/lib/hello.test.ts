import { describe, expect, it } from 'vitest'
import { helloQuery, isoWeek, periods, type Kept } from './hello'

describe('hello', () => {
  it('names ISO weeks', () => {
    expect(isoWeek(new Date('2026-11-04T12:00:00Z'))).toBe('2026-W45')
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53')
    expect(isoWeek(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01')
  })
  it('says hello once a day, with only yes/no answers', () => {
    const now = periods(new Date('2026-11-04T09:00:00Z'))
    const q = (last: Kept | null, home = false, lang?: string) => helloQuery(last, now, home, lang)?.q ?? null
    const was = (d: string): Kept => ({ ...periods(new Date(d)), first: '2026-11-01' })
    expect(q(null)).toBe('new=1&week=1&month=1&lang=en&start=1')
    expect(q({ ...now, first: now.day }, true)).toBeNull()
    expect(q(was('2026-11-03T09:00:00Z'), true, 'fr')).toBe('home=1&lang=fr')
    expect(q(was('2026-11-01T09:00:00Z'))).toBe('week=1&lang=en')
    expect(q({ ...periods(new Date('2026-10-31T09:00:00Z')), first: '2026-10-31' })).toBe('week=1&month=1&lang=en')
  })
  it('starts counting days for a device from before, once', () => {
    const now = periods(new Date('2026-11-04T09:00:00Z'))
    const r = helloQuery(periods(new Date('2026-11-03T09:00:00Z')), now, false)!
    expect(r.q).toBe('lang=en&start=1')
    expect(r.keep.first).toBe('2026-11-04')
  })
  it('tells once that a device still opens after a week, a month, three months', () => {
    const now = periods(new Date('2026-12-05T09:00:00Z'))
    const r = helloQuery({ ...periods(new Date('2026-12-04T09:00:00Z')), first: '2026-11-04', kept: [7] }, now, false)!
    expect(r.q).toBe('lang=en&kept=30')
    expect(r.keep.kept).toEqual([7, 30])
    expect(helloQuery({ ...r.keep, day: '2026-12-04' }, now, false)!.q).toBe('lang=en')
  })
  it('adds where and when it opens, and the counts since the last hello', () => {
    const now = periods(new Date('2026-11-04T09:00:00Z'))
    const r = helloQuery({ ...periods(new Date('2026-11-03T09:00:00Z')), first: '2026-11-03' }, now, false, 'fr',
      { version: 'LSG', platform: 'mac', hour: 7, weekday: 0, tally: { pr: 2, ch: 0, bm: 1 } })!
    expect(r.q).toBe('lang=fr&bible=LSG&on=mac&h=7&wd=0&pr=2&bm=1')
  })
})
