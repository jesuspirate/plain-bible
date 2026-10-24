import { describe, expect, it } from 'vitest'
import { dayBefore, dayOf, Days, fromShared, mergeDays, PRAY, READ, shareable, streak, streaks } from './streaks'

const T = '2026-10-24'
/** Days from a pattern read newest first: R read, P prayed, B both, . nothing. */
function days(pattern: string, end = T): Days {
  const out: Days = {}
  let d = end
  for (const c of pattern) {
    const b = c === 'R' ? READ : c === 'P' ? PRAY : c === 'B' ? READ | PRAY : 0
    if (b) out[d] = b
    d = dayBefore(d)
  }
  return out
}

describe('days', () => {
  it('steps across months and years', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28')
    expect(dayBefore('2026-01-01')).toBe('2025-12-31')
    expect(dayBefore('2026-10-24', -8)).toBe('2026-11-01')
    expect(dayOf(new Date(2026, 9, 24, 23, 59))).toBe('2026-10-24')
  })
  it('merges by keeping every day done anywhere', () => {
    expect(mergeDays({ [T]: READ }, { [T]: PRAY, '2026-10-23': READ })).toEqual({ [T]: 3, '2026-10-23': READ })
    expect(mergeDays({ bad: 1, [T]: 7 } as Days, undefined)).toEqual({ [T]: 3 })
  })
})

describe('streaks', () => {
  it('counts days in a row', () => {
    expect(streak(days('RRRR'), READ, T)).toBe(4)
    expect(streak(days('RRRR'), PRAY, T)).toBe(0)
  })
  it('lets today still be done', () => {
    expect(streak(days('.RRR'), READ, T)).toBe(3)
  })
  it('forgives one missed day', () => {
    expect(streak(days('RR.RR'), READ, T)).toBe(4)
    // missed yesterday, today not done yet: still alive, today can save it
    expect(streak(days('..RR'), READ, T)).toBe(2)
  })
  it('ends on two missed days in a row', () => {
    expect(streak(days('RR..RR'), READ, T)).toBe(2)
    expect(streak(days('...RR'), READ, T)).toBe(0)
  })
  it('forgives only one missed day a week', () => {
    expect(streak(days('RR.RR.RR'), READ, T)).toBe(4)
    expect(streak(days('RR.RRRRRR.RR'), READ, T)).toBe(10)
  })
  it('keeps reading and prayer apart', () => {
    const s = streaks(days('BRPB'), T)
    expect(s).toEqual({ read: 3, pray: 3, readToday: true, prayToday: true })
  })
})

describe('sharing', () => {
  it('sends only as far back as the streaks go, and reads back the same counts', () => {
    const d = { ...days('BRB.R'), ...days('RRR', '2026-09-01') }
    const s = shareable(d, T)
    expect(s.end).toBe(T)
    expect(s.d).toBe('31301')
    const back = fromShared(JSON.parse(JSON.stringify(s)))
    expect(streaks(back, T)).toEqual(streaks(d, T))
    // a day later, with nothing new, the circle still sees the streak alive
    expect(streak(back, READ, dayBefore(T, -1))).toBe(4)
  })
  it('ignores what isn’t a streak', () => {
    expect(fromShared(null)).toEqual({})
    expect(fromShared({ end: 'x', d: '1' })).toEqual({})
  })
})
