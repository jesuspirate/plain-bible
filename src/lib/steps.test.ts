// Show what happens: the steps written down while the person uses the app.
import { afterEach, describe, expect, it, vi } from 'vitest'

// Just enough of a browser for the recorder.
const store = new Map<string, string>()
const body = {}
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
vi.stubGlobal('document', { body, documentElement: { dataset: { theme: 'light' } }, addEventListener() {}, removeEventListener() {} })
vi.stubGlobal('location', { hash: '#/read' })
vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844)
vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
type El = { tagName: string; className?: string; id?: string; textContent?: string; attrs?: Record<string, string>; parentElement: El | typeof body | null }
const el = (tagName: string, className: string, parentElement: El | typeof body, textContent = ''): El & { getAttribute(k: string): string | null } =>
  ({ tagName, className, id: '', textContent, parentElement, getAttribute: () => null })

const { addStep, clearSteps, describeSpot, recordedSteps, recording, resumeSteps, screenOf, startSteps, stopSteps } = await import('./steps')

afterEach(() => { stopSteps(); clearSteps(); location.hash = '#/read' })

describe('steps', () => {
  it('writes each step with the time since Start, and stops', () => {
    startSteps(1_000)
    addStep('Screen #/settings', 4_000)
    addStep('Screen #/settings', 4_500)
    addStep('Tap x', 75_000)
    stopSteps(80_000)
    const s = recordedSteps()
    expect(s[0]).toMatch(/^0:00 Started on /)
    expect(s.slice(1)).toEqual(['0:03 Screen #/settings', '1:14 Tap x', '1:19 Stopped'])
    expect(recording()).toBe(false)
    addStep('after')
    expect(recordedSteps()).toHaveLength(4)
  })
  it('keeps the first and the latest when there are many', () => {
    startSteps(0)
    for (let i = 0; i < 200; i++) addStep('step ' + i, i * 1000)
    const s = recordedSteps()
    expect(s[0]).toMatch(/Started/)
    expect(s[1]).toBe('… 81 earlier steps not kept')
    expect(s[s.length - 1]).toBe('3:19 step 199')
  })
  it('carries on after the app reloads', () => {
    startSteps()
    addStep('Tap y')
    expect(resumeSteps()).toBe(true)
    expect(recordedSteps().at(-1)).toMatch(/App reloaded/)
  })
  it('names a button by its words, but never other text on the page', () => {
    const button = el('BUTTON', 'listen', el('DIV', 'bar', body), ' Écouter ')
    const at = (e: El) => describeSpot(e as unknown as Element, 50, 100, 100, 200)
    expect(at(el('SPAN', '', button, 'Écouter'))).toBe('“Écouter” [div.bar > button.listen > span] at 50% across, 50% down')
    expect(at(el('SPAN', '', el('P', 'note', body, 'my private prayer'), 'my private prayer'))).toBe('[p.note > span] at 50% across, 50% down')
  })
  // Links carry secrets in the address: a circle invite's key, a device
  // link's key. A search carries the words typed. None of it goes in a report.
  const KEY43 = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE'
  const ID22 = 'abcdefghijklmnopqrstuv'
  it('keeps where in the app, never a link\'s secret or typed words', () => {
    expect(screenOf('#/read/KJV/John/3?v=16&e=18')).toBe('#/read/KJV/John/3?v=16&e=18')
    expect(screenOf('')).toBe('#/')
    expect(screenOf(`#/join?i=${ID22}&k=${KEY43}`)).toBe('#/join?i=…&k=…')
    expect(screenOf(`#/join?d=${ID22}&k=${KEY43}`)).toBe('#/join?d=…&k=…')
    expect(screenOf(`#/move/${ID22}.${KEY43}`)).toBe('#/move/…')
    expect(screenOf(`#/read/${ID22}.${KEY43}/Gen/1`)).toBe('#/read/…/Gen/1')
    expect(screenOf('#/search?q=my%20private%20words&v=KJV')).toBe('#/search?q=…&v=KJV')
  })
  it('never writes a secret from the address into the steps', () => {
    location.hash = `#/join?i=${ID22}&k=${KEY43}`
    startSteps()
    location.hash = `#/move/${ID22}.${KEY43}`
    expect(resumeSteps()).toBe(true)
    stopSteps()
    const all = recordedSteps().join('\n')
    expect(all).not.toContain(KEY43)
    expect(all).not.toContain(ID22)
    expect(all).toMatch(/Started on #\/join\?i=…&k=… /)
    expect(all).toMatch(/App reloaded · #\/move\/…/)
  })
  it('never writes a one-time code someone tapped', () => {
    const code = { ...el('P', 'c-bigcode', body, '481 592'), getAttribute: (k: string) => k === 'aria-label' ? '4 8 1 5 9 2' : null }
    expect(describeSpot(code as unknown as Element, 50, 100, 100, 200)).toBe('“…” [p.c-bigcode] at 50% across, 50% down')
  })
  it('cleans steps an older version saved with the whole address', () => {
    startSteps(0)
    addStep(`Screen #/join?i=${ID22}&k=${KEY43}`, 1_000)
    expect(recordedSteps()[1]).toBe('0:01 Screen #/join?i=…&k=…')
  })
})
