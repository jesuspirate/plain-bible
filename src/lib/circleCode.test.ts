import { beforeEach, describe, expect, it, vi } from 'vitest'

// Joining with a code: the four digits both phones compare come from the key
// the joining phone sends, so they must not change once shown.
const calls: { path: string; body?: any }[] = []
let answer: (path: string, body?: any) => unknown = () => ({ ok: true })
vi.mock('./sync', async orig => ({
  ...(await orig<typeof import('./sync')>()),
  SYNC_URL: 'https://sync.test',
  loadAccount: () => ({ token: 't' }),
  api: async (path: string, init: { body?: unknown } = {}) => {
    calls.push({ path, body: init.body })
    await new Promise(r => setTimeout(r, 5))
    return answer(path, init.body)
  },
}))
const { makeCode, dropCode, doneWithCode, typeCode, stopWaiting } = await import('./circles')
const { SyncError } = await import('./sync')

beforeEach(() => { calls.length = 0; answer = () => ({ ok: true }) })

describe('typing a code', () => {
  it('a double tap sends one key and shows one set of digits', async () => {
    const [a, b] = await Promise.all([typeCode('123456'), typeCode('123456')])
    expect(a.match).toBe(b.match)
    expect(calls.filter(c => c.path === '/circles/code')).toHaveLength(1)
    await stopWaiting(a)
  })
  it('trying again sends the same key, so the digits stay the same', async () => {
    answer = () => { throw new SyncError('offline', 0) }
    await expect(typeCode('222222')).rejects.toThrow()
    answer = () => ({ ok: true })
    const t = await typeCode('222222')
    const posts = calls.filter(c => c.path === '/circles/code')
    expect(posts).toHaveLength(2)
    expect(posts[0].body.pub).toBe(posts[1].body.pub)
    expect(t.pub).toBe(posts[0].body.pub)
    await stopWaiting(t)
  })
  it('a wrong code keeps nothing; cancelling starts fresh', async () => {
    answer = () => { throw new SyncError('wrong', 404) }
    await expect(typeCode('333333')).rejects.toThrow()
    answer = () => ({ ok: true })
    const t = await typeCode('333333')
    const posts = calls.filter(c => c.path === '/circles/code')
    expect(posts[0].body.pub).not.toBe(posts[1].body.pub)
    await stopWaiting(t)
    const again = await typeCode('333333')
    expect(again.pub).not.toBe(t.pub)
    await stopWaiting(again)
  })
})

describe('showing a code', () => {
  it('the code box shown again keeps the same code', async () => {
    let n = 0
    answer = () => ({ code: String(100000 + ++n), expires: Date.now() + 15 * 60_000 })
    const [a, b] = await Promise.all([makeCode('c1'), makeCode('c1')])
    const c = await makeCode('c1')
    expect(a.code).toBe(b.code)
    expect(c.code).toBe(a.code)
    expect(calls.filter(x => x.path === '/circles/c1/code')).toHaveLength(1)
    answer = () => ({ ok: true })
    await dropCode('c1', a.code)
  })
  it('a new code once the old one is used, cancelled or nearly expired', async () => {
    let n = 0
    answer = () => ({ code: String(200000 + ++n), expires: Date.now() + (n === 1 ? 30_000 : 15 * 60_000) })
    const a = await makeCode('c2')
    const b = await makeCode('c2')
    expect(b.code).not.toBe(a.code)
    doneWithCode('c2')
    const c = await makeCode('c2')
    expect(c.code).not.toBe(b.code)
    doneWithCode('c2')
  })
})
