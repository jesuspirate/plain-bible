// A problem report or a suggestion from Settings, made into a plain email
// for the app's maker. Only the words, a reply address if the person typed
// one, and the app's version, kind of device and language (short labels,
// cleaned). A problem also brings the screen, the steps the person recorded
// (Show what happens) and the last few errors the app ran into.

const SUGGEST_MAX = 3000
/** A short plain label from the app (version, device, language), or '?'. */
const label = (v: unknown, n = 40) => (typeof v === 'string' ? v.replace(/[^\w .:/()+×#%-]/g, '').trim().slice(0, n) : '') || '?'
/** Free text from the app (a spot, an error): one line, no controls, kept short. */
const line = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n) : '')
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/

export type SuggestBody = {
  kind?: unknown; text?: unknown; email?: unknown; version?: unknown; platform?: unknown; lang?: unknown
  screen?: unknown; steps?: unknown; where?: unknown; errors?: unknown; size?: unknown; theme?: unknown
}
export type SuggestMail = { subject: string; text: string; replyTo?: string }

export function suggestionMail(b: SuggestBody | null): { ok: true; mail: SuggestMail } | { ok: false; why: 'empty' | 'long' | 'email' } {
  const text = typeof b?.text === 'string' ? b.text.replace(/\r\n?/g, '\n').trim() : ''
  if (!text) return { ok: false, why: 'empty' }
  if (text.length > SUGGEST_MAX) return { ok: false, why: 'long' }
  const raw = typeof b?.email === 'string' ? b.email.trim() : ''
  const email = raw && raw.length <= 254 && EMAIL.test(raw) ? raw : ''
  if (raw && !email) return { ok: false, why: 'email' }
  const problem = b?.kind === 'problem'
  const first = text.split('\n')[0]
  const subject = (problem ? 'Problem: ' : 'Suggestion: ') + (first.length > 60 ? first.slice(0, 59) + '…' : first)
  const about = [
    email ? `Reply goes to: ${email}` : 'No reply address given.',
    `App: ${label(b?.version)} · ${label(b?.platform)} · ${label(b?.lang)}`,
  ]
  if (problem) {
    const errors = Array.isArray(b?.errors) ? b.errors.slice(-5).map(e => line(e, 200)).filter(Boolean) : []
    about.push(`Screen: ${label(b?.screen, 120)} · ${label(b?.size, 20)} · theme ${label(b?.theme, 12)}`)
    // Older apps sent one tapped spot as `where`.
    const steps = Array.isArray(b?.steps) ? b.steps.slice(0, 125).map(s => line(s, 240)).filter(Boolean) : []
    const where = line(b?.where, 300)
    about.push(steps.length ? `Steps recorded (${steps.length}):\n` + steps.map(s => '  ' + s).join('\n')
      : where ? `Spot shown: ${where}` : 'Steps recorded: none')
    about.push(errors.length ? 'Errors the app noticed:\n' + errors.map(e => '  - ' + e).join('\n') : 'Errors the app noticed: none')
  }
  const body = `${text}\n\n—\n${about.join('\n')}\n\nSent from Settings → Report a problem in My Quiet Bible.`
  return { ok: true, mail: { subject, text: body, ...(email ? { replyTo: email } : {}) } }
}
