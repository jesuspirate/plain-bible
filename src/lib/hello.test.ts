import { describe, expect, it } from 'vitest'
import { helloQuery, isoWeek, periods } from './hello'

describe('hello', () => {
  it('names ISO weeks', () => {
    expect(isoWeek(new Date('2026-11-04T12:00:00Z'))).toBe('2026-W45')
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53')
    expect(isoWeek(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01')
  })
  it('says hello once a day, with only yes/no answers', () => {
    const now = periods(new Date('2026-11-04T09:00:00Z'))
    expect(helloQuery(null, now, false)).toBe('new=1&week=1&month=1')
    expect(helloQuery(now, now, true)).toBeNull()
    expect(helloQuery(periods(new Date('2026-11-03T09:00:00Z')), now, true)).toBe('home=1')
    expect(helloQuery(periods(new Date('2026-11-01T09:00:00Z')), now, false)).toBe('week=1')
    expect(helloQuery(periods(new Date('2026-10-31T09:00:00Z')), now, false)).toBe('week=1&month=1')
  })
})
