import { describe, expect, it } from 'vitest'
import { previous, touch, Trail, visit } from './history'

const at = (book: string, chapter: number, verse = 1) => ({ book, chapter, verse })
const names = (t: Trail) => t.items.map(x => `${x.book} ${x.chapter}:${x.verse}`)
const empty: Trail = { items: [] }

describe('reading history', () => {
  it('adds jumps and folds chapter turns into the current place', () => {
    let t = visit(at('Gen', 1), empty, 1)
    t = visit(at('Gen', 2), t, 2)
    t = visit(at('Gen', 3), t, 3)
    t = touch(at('Gen', 3, 14), t)
    t = visit(at('John', 3, 16), t, 4)
    expect(names(t)).toEqual(['Gen 3:14', 'John 3:16'])
  })
  it('turns across the end of a book', () => {
    const t = visit(at('Exod', 1), visit(at('Gen', 50), empty, 1), 2)
    expect(names(t)).toEqual(['Exod 1:1'])
  })
  it('bounces between two places when you go back twice', () => {
    let t = visit(at('John', 3), visit(at('Exod', 12, 5), empty))
    t = visit(previous(t)[0], t)
    expect(names(t)).toEqual(['John 3:1', 'Exod 12:5'])
    t = visit(previous(t)[0], t)
    expect(names(t)).toEqual(['Exod 12:5', 'John 3:1'])
  })
  it('keeps where you are and the three places before it', () => {
    let t = empty
    for (const b of ['Gen', 'Ps', 'Isa', 'Matt', 'John']) t = visit(at(b, 5), t)
    expect(previous(t).map(p => p.book)).toEqual(['Matt', 'Isa', 'Ps'])
  })
})
