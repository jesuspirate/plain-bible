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

const { addStep, clearSteps, describeSpot, recordedSteps, recording, resumeSteps, startSteps, stopSteps } = await import('./steps')

afterEach(() => { stopSteps(); clearSteps() })

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
})
