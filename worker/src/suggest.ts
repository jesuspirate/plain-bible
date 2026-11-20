// A suggestion from Settings, made into a plain email for the app's maker.
// Only the words, a reply address if the person typed one, and the app's
// version, kind of device and language (short labels, cleaned).

const SUGGEST_MAX = 3000
/** A short plain label from the app (version, device, language), or '?'. */
const label = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\w .:/()+-]/g, '').trim().slice(0, 40) : '') || '?'
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/

export type SuggestBody = { text?: unknown; email?: unknown; version?: unknown; platform?: unknown; lang?: unknown }
export type SuggestMail = { subject: string; text: string; replyTo?: string }

export function suggestionMail(b: SuggestBody | null): { ok: true; mail: SuggestMail } | { ok: false; why: 'empty' | 'long' | 'email' } {
  const text = typeof b?.text === 'string' ? b.text.replace(/\r\n?/g, '\n').trim() : ''
  if (!text) return { ok: false, why: 'empty' }
  if (text.length > SUGGEST_MAX) return { ok: false, why: 'long' }
  const raw = typeof b?.email === 'string' ? b.email.trim() : ''
  const email = raw && raw.length <= 254 && EMAIL.test(raw) ? raw : ''
  if (raw && !email) return { ok: false, why: 'email' }
  const first = text.split('\n')[0]
  const subject = 'Suggestion: ' + (first.length > 60 ? first.slice(0, 59) + '…' : first)
  const body = `${text}\n\n—\n${email ? `Reply goes to: ${email}` : 'No reply address given.'}\nApp: ${label(b?.version)} · ${label(b?.platform)} · ${label(b?.lang)}\n\nSent from Settings → Send a suggestion in My Quiet Bible.`
  return { ok: true, mail: { subject, text: body, ...(email ? { replyTo: email } : {}) } }
}
