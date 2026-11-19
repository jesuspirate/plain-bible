import { describe, expect, it } from 'vitest'
import { bookmarkRuns } from '../saved'
import type { Marks } from './marks'

describe('bookmarkRuns', () => {
  it('joins bookmarks on verses next to each other, whenever they were made', () => {
    const marks = {
      'Rom.8.24': { b: true, t: 5 }, 'Rom.8.25': { b: true, t: 9 }, 'Rom.8.26': { b: true, t: 1 },
      'Rom.8.28': { b: true, t: 2 }, 'Rom.9.1': { b: true, t: 3 }, 'Jas.1.22': { c: '#fff', t: 4 },
    } as unknown as Marks
    const runs = bookmarkRuns(['Rom.8.24', 'Rom.8.25', 'Rom.8.26', 'Rom.8.28', 'Rom.9.1', 'Jas.1.22'], marks)
    expect(runs.map(r => [r.chapter, r.verses, r.t])).toEqual([[8, [24, 25, 26], 9], [8, [28], 2], [9, [1], 3]])
    expect(runs[0].keys).toEqual(['Rom.8.24', 'Rom.8.25', 'Rom.8.26'])
  })
})
