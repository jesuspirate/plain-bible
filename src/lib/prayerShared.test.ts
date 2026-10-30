import { describe, expect, it } from 'vitest'
import { circlesWithAll, sharedIn } from './prayerShared'

const circles = [{ id: 'a', name: 'Home' }, { id: 'b', name: 'Friends' }]
const prayer = (by: string, prayed?: number) => ({ by, body: { k: 'prayer', ...(prayed ? { prayed } : {}) } })

describe('which circles have a prayer', () => {
  it('counts your own prayers in each feed, and what was sent from here', () => {
    const shared = sharedIn(circles, {
      a: { me: 'm1', items: [prayer('m1', 100), prayer('m2', 200), { by: 'm1', body: { k: 'verse' } }, prayer('m1')] },
    }, { b: [300] })
    expect([...shared.get('a')!]).toEqual([100])
    expect([...shared.get('b')!]).toEqual([300])
  })
  it('a circle has a day only when it has every prayer of it', () => {
    const shared = sharedIn(circles, {}, { a: [1, 2], b: [1] })
    expect([...circlesWithAll(shared, [1])]).toEqual(['a', 'b'])
    expect([...circlesWithAll(shared, [1, 2])]).toEqual(['a'])
    expect([...circlesWithAll(shared, [])]).toEqual([])
  })
})
