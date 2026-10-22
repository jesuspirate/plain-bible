import { describe, expect, it } from 'vitest'
import { step, touch, Trail, visit } from './history'

const at = (book: string, chapter: number, verse = 1) => ({ book, chapter, verse })
const names = (t: Trail) => t.items.map(x => `${x.book} ${x.chapter}:${x.verse}`)
const empty: Trail = { items: [], i: -1 }

describe('reading history', () => {
  it('adds jumps and folds chapter turns into the current place', () => {
    let t = visit(at('Gen', 1), empty, 1)
    t = visit(at('Gen', 2), t, 2)
    t = visit(at('Gen', 3), t, 3)
    t = touch(at('Gen', 3, 14), t)
    t = visit(at('John', 3, 16), t, 4)
    expect(names(t)).toEqual(['Gen 3:14', 'John 3:16'])
    expect(t.i).toBe(1)
  })
  it('turns across the end of a book', () => {
    const t = visit(at('Exod', 1), visit(at('Gen', 50), empty, 1), 2)
    expect(names(t)).toEqual(['Exod 1:1'])
  })
  it('steps back and forward without adding places', () => {
    let t = visit(at('John', 3), visit(at('Ps', 23), visit(at('Gen', 1), empty)))
    const back = step(-1, t)!
    expect(back.book).toBe('Ps')
    t = visit(back, t)
    expect(t.i).toBe(1)
    expect(names(t)).toEqual(['Gen 1:1', 'Ps 23:1', 'John 3:1'])
    const fwd = step(1, t)!
    t = visit(fwd, t)
    expect(t.i).toBe(2)
    expect(step(1, t)).toBeUndefined()
  })
  it('moves a place you return to by jumping to the end', () => {
    let t = visit(at('John', 3), visit(at('Ps', 23), visit(at('Gen', 1), empty)))
    t = visit(at('Gen', 1, 5), t)
    expect(names(t)).toEqual(['Ps 23:1', 'John 3:1', 'Gen 1:5'])
  })
})
