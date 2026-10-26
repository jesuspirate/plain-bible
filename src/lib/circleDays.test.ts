import { describe, expect, it } from 'vitest'
import { byDay, dayOf } from './circleDays'

const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime()
const items = [
  { id: 'a', at: at(25, 18) }, { id: 'b', at: at(25, 9) },
  { id: 'c', at: at(24, 20) },
  { id: 'd', at: at(22, 7) }, { id: 'e', at: at(22, 6) },
]

describe('circle days', () => {
  it('groups by day, newest first', () => {
    const { days, more } = byDay(items, new Set(), 10)
    expect(days.map(d => d.items.map(i => i.id))).toEqual([['a', 'b'], ['c'], ['d', 'e']])
    expect(days[0].day).toBe(dayOf(at(25, 0)))
    expect(more).toBe(false)
  })
  it('puts what is new first, and not again in its day', () => {
    const { days } = byDay(items, new Set(['c']), 10)
    expect(days.map(d => d.day === 'new' ? 'new' : d.items.map(i => i.id).join())).toEqual(['new', 'a,b', 'd,e'])
  })
  it('stops after whole days once enough are shown', () => {
    const { days, more } = byDay(items, new Set(), 2)
    expect(days.map(d => d.items.length)).toEqual([2])
    expect(more).toBe(true)
    expect(byDay(items, new Set(), 3).days.map(d => d.items.length)).toEqual([2, 1])
    expect(byDay(items, new Set(), 4).more).toBe(false)
  })
})
