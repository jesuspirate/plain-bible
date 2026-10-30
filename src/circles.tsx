// Circles: a few people sharing what they read and pray. #/circles lists
// yours, #/circles/<id> shows one, and #/join?… is an invite link. Loaded
// only when one of these opens, or when something is shared.
import { createContext } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import {
  accountKeyCode, amen, dayAt, CircleInfo, createCircle, Feed, FeedItem, Invite, inviteLink, joinCircle, keptCircles, keptFeed,
  leaveCircle, listCircles, renameCircle, type News, openInvited, react, type Reaction, REACTS, makeCode, dropCode, doneWithCode, codeAsk, allowCode, typeCode, stopWaiting, joinWithCode, Typed, loadFeed, newsIn, parseInviteLink, prayerAudio, readInvite, removeReply, removeShared, reply, sharePrayer, shareStreak, shareVerse,
} from './lib/circles'
import { streaks } from './lib/streaks'
import { useDays } from './streaks'
import { duration, prayers } from './lib/prayers'
import { playable } from './lib/mp4'
import { PrayerVerse, verseLabel, versesOf } from './lib/prayerVerses'
import { chapterSize, inYourBible, readerVersions, Shown } from './lib/passage'
import { renumbered, toStandard } from './lib/versification'
import { loadAccount, noPasskey, prepareSignIn, register, signIn, SYNC_URL } from './lib/sync'
import { AskApproval } from './approve'
import { startOver } from './lib/prayerSync'
import { markKey, newNoteId, notesCovering, setNote, tidy } from './lib/marks'
import { canShare, copyText } from './lib/native'
import { go, openCircles, readPath, Route, ShareRequest, useApp } from './state'
import { hasNews, markSeen, seenAt, useCircleNews } from './lib/circleNews'
import { byDay, dayOf } from './lib/circleDays'
import { BackIcon, BellIcon, BookmarkIcon } from './icons'
import { blockedHelp, clearNotifications, prepareKey, pushOn, pushSupport, turnOff, turnOn } from './lib/push'
import { Sheet } from './ui'
import './circles.css'
import { locale, t, tj, tn } from './i18n'

const NAME = 'plain-bible:circle-name'
const lastName = () => { try { return localStorage.getItem(NAME) || '' } catch { return '' } }
const keepName = (s: string) => { try { localStorage.setItem(NAME, s) } catch { /* ignore */ } }
const message = (e: unknown) => {
  const m = (e as Error).message
  return m === 'Cancelled' ? t('The passkey request was cancelled. Tap to try again.') : m
}
/** A passage someone shared, in the reader's own Bible: undefined while it's
 *  looked up (so their words never flash first), null if there's nothing
 *  to show. The sender's words are only the last resort (see lib/passage). */
function usePassage(verse: PrayerVerse | undefined, theirs?: { text: string; version: string; size?: number }) {
  const { data, settings, byId } = useApp()
  const ids = verse ? readerVersions(settings, id => byId.get(id)?.lang).filter(id => byId.get(id)?.books.includes(verse.book) ?? true) : []
  const [shown, setShown] = useState<Shown | null>()
  const at = verse ? `${verse.book} ${verse.chapter}:${verse.verses.join()}` : ''
  useEffect(() => {
    let alive = true
    setShown(undefined)
    if (!verse) { setShown(null); return }
    inYourBible(id => data.bible(id), ids, verse, theirs).then(s => { if (alive) setShown(s ?? null) }, () => { if (alive) setShown(null) })
    return () => { alive = false }
  }, [at, ids.join()])
  return shown
}

/** Another verse a prayer was prayed using: a link to it in your own Bible. */
function MoreVerse({ verse }: { verse: PrayerVerse }) {
  const { settings } = useApp()
  const shown = usePassage(verse)
  const nav = useNav()
  const at = shown?.at ?? verse
  return <button class="link c-ref c-ref-more" onClick={() => { nav.away(); go(readPath(shown?.version ?? settings.version, at.book, at.chapter, at.verses[0])) }}>
    {t('With {verse}', { verse: verseLabel(at) })}{shown && <span class="muted small"> ({shown.version})</span>}
  </button>
}

/** The passage's words, said plainly when they had to be the sender's. */
function Passage({ shown, small, from }: { shown: Shown | null | undefined; small?: boolean; from: string }) {
  const { settings } = useApp()
  if (shown === null) return null
  return <>
    <p class={'c-quote' + (small ? ' small' : '') + (shown ? '' : ' c-quote-wait')} aria-busy={!shown}>{shown?.text}</p>
    {shown && !shown.yours && <p class="muted small">{t('Your {version} doesn’t have this here, so it’s shown as {name} shared it ({theirs}).', { version: settings.version, name: from, theirs: shown.version })}</p>}
  </>
}

/** The day is said above each group, so only the hour, except among the new. */
const when = (at: number, day = false) => new Date(at).toLocaleString(locale(), day ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' })

/** How the circles move between their pages. Inside the prayer screen it
 *  keeps track (its back button steps out), and anything that leads to the
 *  Bible closes it first; as #/circles pages, the URL does. */
interface Nav { sheet: boolean; open: (c?: { id: string; name: string }) => void; away: () => void }
const NavCtx = createContext<Nav>({ sheet: false, open: c => go(c ? `circles/${c.id}` : 'circles'), away: () => {} })
const useNav = () => useContext(NavCtx)

/** Circles inside the prayer screen: the list, or one circle. */
export function CirclesPanel({ circle, onOpen, onAway }: { circle?: string; onOpen: (c?: { id: string; name: string }) => void; onAway: () => void }) {
  if (!SYNC_URL) return <p class="muted">{t('Circles aren’t available in this copy of the app.')}</p>
  return (
    <NavCtx.Provider value={{ sheet: true, open: onOpen, away: onAway }}>
      {!loadAccount() ? <SignedOut /> : circle ? <CircleView key={circle} id={circle} /> : <CircleList />}
    </NavCtx.Provider>
  )
}

function SignedOut() {
  const { sheet } = useNav()
  return (
    <div class="circles">
      {!sheet && <h1>{t('Circles')}</h1>}
      <p>{t('Share the verses you read and the prayers you pray with a few people you choose: family, a friend, a small group.')}</p>
      <p class="muted">{t('Everything you share is encrypted on your device, so only the people in your circle can read or hear it.')}</p>
      <SignIn />
    </div>
  )
}

/** Back to the word, with the prayer screen open on Circles (or one circle). */
function toSheet(circle?: { id: string; name: string }) {
  go('read', true)
  setTimeout(() => openCircles(circle), 60)
}

export function CirclesPage({ route }: { route: Route }) {
  useEffect(() => { document.title = t('Circles') + ' · My Quiet Bible' }, [])
  // Circles live in the prayer screen; #/circles (an older link) opens them there.
  const at = route.path[0] === 'circles' ? route.path[1] : undefined
  useEffect(() => {
    if (route.path[0] !== 'circles') return
    if (!at) { toSheet(); return }
    keptCircles().then(cs => toSheet({ id: at, name: cs.find(c => c.id === at)?.name ?? t('Circle') }))
  }, [route.path.join('/')])
  if (route.path[0] === 'circles') return null
  if (!SYNC_URL) return <div class="circles"><h1>{t('Circles')}</h1><p class="muted">{t('Circles aren’t available in this copy of the app.')}</p></div>
  // An invite opens even before you have an account: it says who it's
  // from, then makes the account right there, without leaving the page.
  if (route.path[0] === 'join') return <Join id={route.params.get('i') ?? ''} secret={route.params.get('k') ?? ''} />
  if (!loadAccount()) return <SignedOut />
  return route.path[1] ? <CircleView id={route.path[1]} /> : <CircleList />
}

/** Make an account or sign in, here, with a passkey. No email, no password. */
function SignIn({ joining }: { joining?: boolean }) {
  const { sync } = useApp()
  const [working, setWorking] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { if (navigator.onLine !== false) prepareSignIn() }, [])
  if (typeof PublicKeyCredential === 'undefined') return <p class="note">{t('This browser can’t use passkeys, which circles need. Try Safari or Chrome.')}</p>
  const act = (label: string, fn: () => Promise<string | undefined>) => async () => {
    setWorking(label); setMsg('')
    try { const token = await fn(); if (token) sync.signedIn(token) } catch (e) {
      const m = (e as Error).message
      setMsg(m === 'Cancelled' ? t('The passkey request was cancelled. Tap to try again.') : m)
      if (label === 'login') prepareSignIn()
    } finally { setWorking('') }
  }
  return (
    <div class="c-card">
      <p class="small">{joining ? t('To join, make a free account with a passkey: your phone unlocks it with Face ID, a fingerprint or your screen lock. No email, no password.')
        : t('Circles need a free account with a passkey: your phone unlocks it with Face ID, a fingerprint or your screen lock. No email, no password.')}</p>
      <div class="c-row">
        <button class="c-btn primary" disabled={!!working} onClick={act('create', () => register())}>{working === 'create' ? t('Waiting for passkey…') : t('Create account')}</button>
        <button class="c-btn" disabled={!!working} onClick={act('login', signIn)}>{working === 'login' ? t('Waiting for passkey…') : t('I have one: sign in')}</button>
      </div>
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

/** The account key typed in, for a device whose passkey can't unlock it. */
function CodeEntry({ busy, onCode, onCancel, onApproved }: { busy: boolean; onCode: (code: string) => void; onCancel: () => void; onApproved: () => void }) {
  const [code, setCode] = useState('')
  return (
    <div class="c-card">
      <p class="muted">{t('This device can’t unlock your circles by itself yet. Let one where they already open allow it:')}</p>
      <AskApproval onDone={onApproved} />
      <p class="muted small">{t('Or type your key from there (Circles → Show my key):')}</p>
      <input class="c-code" value={code} onInput={e => setCode((e.target as HTMLInputElement).value)} placeholder={t('Your key')}
        autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellcheck={false} />
      <div class="c-row">
        <button class="c-btn primary" disabled={busy || !code.trim()} onClick={() => onCode(code)}>{busy ? t('Unlocking…') : t('Unlock')}</button>
        <button class="c-btn" onClick={onCancel}>{t('Cancel')}</button>
      </div>
      <StartOver onDone={onApproved} />
    </div>
  )
}

/** The way out when no device can open your circles or prayers any more:
 *  a new key here. Circles then need a new invite each. */
function StartOver({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!open) return <p class="c-paste"><button class="link small" onClick={() => setOpen(true)}>{t('None of my devices can open them')}</button></p>
  const begin = async () => {
    setBusy(true); setMsg('')
    try { await startOver(); onDone() } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  return (
    <div class="c-card">
      <p class="small">{t('First check the other places you use My Quiet Bible. On iPhone, Safari and the Home Screen app keep separate keys. If one of them opens your circles, tap “Approve from my other phone” above and allow it there.')}</p>
      <p class="small">{t('If nothing opens them, start over with a new key. Prayers saved on this phone stay. Prayers kept only on the server can’t be opened by anyone and are removed. To get back into a circle, ask someone in it for a new invite link.')}</p>
      <div class="c-row">
        <button class="c-btn primary" disabled={busy} onClick={begin}>{busy ? t('Starting over…') : t('Start over with a new key')}</button>
        <button class="c-btn" disabled={busy} onClick={() => setOpen(false)}>{t('Cancel')}</button>
      </div>
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

// The last list seen, so Circles opens with it already in place (see warmCircles).
let lastList: CircleInfo[] | undefined
export const warmList = () => keptCircles().then(k => { lastList = k })

function CircleList() {
  const nav = useNav()
  useCircleNews()
  const [list, setList] = useState<CircleInfo[] | undefined>(lastList)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [needCode, setNeedCode] = useState<'list' | 'create' | ''>('')
  const [making, setMaking] = useState(false)
  const [name, setName] = useState('')
  const [me, setMe] = useState(lastName)
  const [key, setKey] = useState('')
  const [locked, setLocked] = useState(0)
  const [stale, setStale] = useState(0)
  const [joining, setJoining] = useState(false)

  const load = async (unlock = false, code?: string) => {
    setBusy(true); setMsg('')
    try {
      const r = await listCircles(unlock, code)
      if (r === 'needCode') setNeedCode('list')
      else { setList(lastList = r.circles); setLocked(r.locked); setStale(r.stale); setNeedCode('') }
    } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  // What's kept shows at once (and offline); the server fills in the rest.
  // Unlocking can ask for the passkey, so that waits for a tap.
  useEffect(() => { keptCircles().then(k => { setList(lastList = k); if (navigator.onLine !== false) load() }) }, [])
  const unlock = () => load(true)

  const create = async (code?: string) => {
    if (!name.trim() || !me.trim()) return
    setBusy(true); setMsg('')
    try {
      keepName(me.trim())
      const id = await createCircle(name.trim(), me.trim(), code)
      if (id === 'needCode') { setNeedCode('create'); return }
      nav.open({ id, name: name.trim() })
    } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }

  return (
    <div class="circles">
      {!nav.sheet && <h1>{t('Circles')}</h1>}
      <p class="muted">{t('Share verses and prayers with a few people you choose. Everything is encrypted on your device; only your circle can read or hear it.')}</p>
      {needCode
        ? <CodeEntry busy={busy} onCode={c => needCode === 'create' ? create(c) : load(true, c)} onCancel={() => setNeedCode('')}
          onApproved={() => needCode === 'create' ? create() : load(true)} />
        : <>
          {locked > 0 && (
            <div class="c-card">
              <p class="small">{tn(locked, 'One circle isn’t unlocked on this device yet.', '{n} circles aren’t unlocked on this device yet.')}</p>
              <button class="c-btn primary" disabled={busy} onClick={unlock}>{noPasskey() ? (busy ? t('Unlocking…') : t('Unlock')) : busy ? t('Waiting for passkey…') : t('Unlock with my passkey')}</button>
            </div>
          )}
          {stale > 0 && (
            <div class="c-card">
              <p class="small">{tn(stale, 'One circle can’t be opened with your new key yet. Ask someone in it to send you a new invite link, then open it here.', '{n} circles can’t be opened with your new key yet. Ask someone in them to send you a new invite link, then open it here.')}</p>
            </div>
          )}
          {list?.length ? (
            <ul class="c-list">
              {list.map(c => (
                <li><button class="c-open" onClick={() => nav.open(c)}>
                  <strong>{c.name}{hasNews(c.id) && <span class="news-dot" aria-label={t(', something new')} />}</strong>
                  <span class="muted">{hasNews(c.id) ? <span class="c-new-word">{t('Something new')}</span> : c.members === 1 ? t('Just you so far') : tn(c.members, '{n} person', '{n} people')} ›</span>
                </button></li>
              ))}
            </ul>
          ) : list && !busy && !locked && <p>{t('You’re not in a circle yet. Join one with a code, or make your own.')}</p>}
          {making ? (
            <div class="c-card">
              <label class="c-label">{t('Name of the circle')}<input value={name} maxLength={60} placeholder={t('Family, Tuesday group…')} onInput={e => setName((e.target as HTMLInputElement).value)} /></label>
              <label class="c-label">{t('Your name')}<input value={me} maxLength={40} placeholder={t('How the others will see you')} onInput={e => setMe((e.target as HTMLInputElement).value)} /></label>
              <div class="c-row">
                <button class="c-btn primary" disabled={busy || !name.trim() || !me.trim()} onClick={() => create()}>{busy ? t('Making…') : t('Make circle')}</button>
                <button class="c-btn" onClick={() => setMaking(false)}>{t('Cancel')}</button>
              </div>
            </div>
          ) : joining ? <JoinCode onCancel={() => setJoining(false)} /> : (
            <div class="c-row c-two">
              <button class="c-btn primary" onClick={() => setJoining(true)}>{t('Enter a code')}</button>
              <button class="c-btn" onClick={() => setMaking(true)}>{t('New circle')}</button>
            </div>
          )}
          {!joining && !making && <PasteInvite />}
        </>}
      {msg && <p class="note small">{msg} {!needCode && <button class="link" onClick={() => load()}>{t('Try again')}</button>}</p>}
      <div class="c-foot">
        {key
          ? <><p class="c-key"><code>{key.replace(/-/g, '-​')}</code></p>
            <p class="muted small">{t('Only needed on a device whose passkey can’t unlock your circles. Keep it private: it opens your circles and your synced prayers.')}</p></>
          : <button class="link small" onClick={() => accountKeyCode().then(k => setKey(k || t('Open a circle on this device first.')))}>{t('Show my key')}</button>}
      </div>
    </div>
  )
}

/** Checks something every few seconds while shown. */
function useEvery(ms: number, fn: () => Promise<boolean | void>, on: boolean) {
  const f = useRef(fn)
  f.current = fn
  useEffect(() => {
    if (!on) return
    let stop = false, t = 0
    const tick = async () => { if (stop) return; const done = await f.current().catch(() => false); if (!done && !stop) t = window.setTimeout(tick, ms) }
    t = window.setTimeout(tick, ms)
    return () => { stop = true; clearTimeout(t) }
  }, [on, ms])
}

const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`

/** A member's side of joining with a code: the code, then "Let them in?". */
function ShowCode({ circle, onDone, onAllowed }: { circle: string; onDone: () => void; onAllowed: () => void }) {
  const [code, setCode] = useState<{ code: string; expires: number }>()
  const [ask, setAsk] = useState<{ label: string; match: string; pub: string }>()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => { makeCode(circle).then(setCode, e => setMsg(message(e))) }, [circle])
  useEvery(2500, async () => {
    if (!code) return
    if (Date.now() > code.expires) { doneWithCode(circle); setMsg(t('This code has expired.')); return true }
    const a = await codeAsk(circle, code.code)
    if (a) { setAsk(a); return true }
  }, !!code && !ask && !done && !msg)
  const close = () => { if (code && !done) dropCode(circle, code.code); onDone() }
  const allow = async () => {
    setBusy(true); setMsg('')
    try { await allowCode(circle, code!.code, ask!.pub); doneWithCode(circle); setDone(true); onAllowed() } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  return (
    <div class="c-card c-codebox">
      {done ? <>
        <p class="c-card-title">{t('They’re in')}</p>
        <p class="muted small">{t('They’ll show up here as soon as their phone finishes joining.')}</p>
        <button class="c-btn primary" onClick={onDone}>{t('Done')}</button>
      </> : ask ? <>
        <p class="c-card-title">{t('Let their {device} in?', { device: t(ask.label) })}</p>
        <p class="muted small">{t('Only if their screen shows these same digits:')}</p>
        <p class="c-bigcode" aria-label={ask.match.split('').join(' ')}>{ask.match}</p>
        <div class="c-row c-two">
          <button class="c-btn primary" disabled={busy} onClick={allow}>{busy ? t('Letting in…') : t('Allow')}</button>
          <button class="c-btn" disabled={busy} onClick={close}>{t('Not them')}</button>
        </div>
      </> : <>
        <p class="c-card-title">{t('Their code')}</p>
        <p class="c-bigcode" aria-label={code?.code.split('').join(' ')}>{code ? spaced(code.code) : '··· ···'}</p>
        <p class="muted small">{tj('On their phone: Circles → {enter}. Works once, for 15 minutes. Keep this open.', { enter: <strong>{t('Enter a code')}</strong> })}</p>
        <button class="c-btn" onClick={close}>{t('Cancel')}</button>
      </>}
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

/** The joining side: type the code, compare four digits, wait for Allow. */
function JoinCode({ onCancel }: { onCancel: () => void }) {
  const nav = useNav()
  const [code, setCode] = useState('')
  const [me, setMe] = useState(lastName)
  const [typed, setTyped] = useState<Typed>()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [needKey, setNeedKey] = useState(false)
  const digits = code.replace(/\D/g, '').slice(0, 6)
  const send = async () => {
    if (digits.length !== 6 || !me.trim()) return
    setBusy(true); setMsg('')
    try { keepName(me.trim()); setTyped(await typeCode(digits)) } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  const finish = async (key?: string) => {
    const r = await joinWithCode(typed!, me.trim(), key)
    if (r === 'needCode') { setNeedKey(true); return true }
    if (r) { setNeedKey(false); nav.open(r); return true }
    return false
  }
  useEvery(2500, async () => { try { return await finish() } catch (e) { setMsg(message(e)); return true } }, !!typed && !needKey && !msg)
  const cancel = () => { if (typed) stopWaiting(typed); onCancel() }
  if (needKey) return <CodeEntry busy={busy} onCode={k => { setBusy(true); finish(k).catch(e => setMsg(message(e))).finally(() => setBusy(false)) }}
    onCancel={cancel} onApproved={() => finish()} />
  return (
    <div class="c-card c-codebox">
      {typed ? <>
        <p class="c-card-title">{t('Ask them to tap Allow')}</p>
        <p class="muted small">{t('Their screen shows these same digits:')}</p>
        <p class="c-bigcode" aria-label={typed.match.split('').join(' ')}>{typed.match}</p>
        <p class="muted small">{t('Waiting for them…')}</p>
        <button class="c-btn" onClick={cancel}>{t('Cancel')}</button>
      </> : <>
        <p class="c-card-title">{t('Enter the code')}</p>
        <input class="c-code-input" value={digits} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000"
          aria-label={t('The 6-digit code')} onInput={e => { setCode((e.target as HTMLInputElement).value); setMsg('') }} />
        <label class="c-label">{t('Your name')}<input value={me} maxLength={40} placeholder={t('How the others will see you')} onInput={e => setMe((e.target as HTMLInputElement).value)} /></label>
        <div class="c-row c-two">
          <button class="c-btn primary" disabled={busy || digits.length !== 6 || !me.trim()} onClick={send}>{busy ? t('Checking…') : t('Join')}</button>
          <button class="c-btn" onClick={cancel}>{t('Cancel')}</button>
        </div>
      </>}
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

/** An invite link opened somewhere else (say in Safari, while you read in
 *  the app on your Home Screen) can be pasted here instead. */
function PasteInvite() {
  const nav = useNav()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const use = (s: string) => {
    const l = parseInviteLink(s)
    if (l) { nav.away(); go(`join?i=${l.i}&k=${l.k}`) }
    else setMsg(t('That isn’t a whole invite link. Copy it again from the message.'))
  }
  const paste = async () => {
    try { const s = await navigator.clipboard.readText(); setText(s); use(s) } catch { setOpen(true) }
  }
  if (!open) return <p class="c-paste"><button class="link small" onClick={() => { setOpen(true); paste() }}>{t('Have an invite link? Paste it')}</button></p>
  return (
    <div class="c-row c-paste">
      <input class="c-code" value={text} placeholder={t('Paste the invite link')} onInput={e => { setText((e.target as HTMLInputElement).value); setMsg('') }}
        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellcheck={false} />
      <button class="c-btn" disabled={!text.trim()} onClick={() => use(text)}>{t('Open')}</button>
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

// A phone's browser, not the app on its Home Screen. Links always open
// there (an iPhone never opens one in a Home Screen app), and the two keep
// separate accounts, so joining here would leave the app outside the circle.
const inBrowser = () => !((navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches)
  && matchMedia('(pointer: coarse)').matches

function OpenInApp() {
  const [copied, setCopied] = useState(false)
  return (
    <div class="c-card">
      <p><strong>{t('Have My Quiet Bible on your Home Screen?')}</strong> {t('Open this invite there, so you join with the account you already use:')}</p>
      <p class="small">{tj('Copy it, open the app, then Circles → {paste}.', { paste: <strong>{t('Have an invite link? Paste it')}</strong> })}</p>
      <button class="c-btn primary" onClick={() => copyText(location.href).then(() => setCopied(true), () => {})}>{copied ? t('Copied: now open the app') : t('Copy invite')}</button>
      <p class="muted small">{t('No app yet? Join right here below.')}</p>
    </div>
  )
}

function Join({ id, secret }: { id: string; secret: string }) {
  const [invite, setInvite] = useState<Invite>()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [needCode, setNeedCode] = useState(false)
  const [me, setMe] = useState(lastName)
  useEffect(() => {
    if (!id || !secret) { setMsg(t('This invite link is incomplete. Ask for it to be sent again.')); return }
    readInvite(id, secret).then(async i => {
      if (!i.already) { setInvite(i); return }
      await openInvited(id, i, lastName() || t('Me'))
      toSheet({ id: i.circle, name: i.name })
    }, e => setMsg(message(e)))
  }, [id, secret])
  const join = async (code?: string) => {
    if (!invite || !me.trim()) return
    setBusy(true); setMsg('')
    try {
      keepName(me.trim())
      const r = await joinCircle(id, invite, me.trim(), code)
      if (r === 'needCode') { setNeedCode(true); return }
      toSheet({ id: invite.circle, name: invite.name })
    } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  return (
    <div class="circles">
      <h1>{t('Join a circle')}</h1>
      {inBrowser() && invite && !needCode && <OpenInApp />}
      {invite && (needCode ? <CodeEntry busy={busy} onCode={join} onCancel={() => setNeedCode(false)} onApproved={() => join()} /> : (
        <div class="c-card">
          <p>{invite.by ? tj('{name} invited you to {circle}', { name: <strong>{invite.by}</strong>, circle: <strong>{invite.name}</strong> }) : tj('You’re invited to {circle}', { circle: <strong>{invite.name}</strong> })}
            <span class="muted"> · {tn(invite.members, '{n} person', '{n} people')}</span></p>
          <p class="muted small">{t('A private circle to read the word and pray together. You’ll see what they share, and they’ll see only what you choose to share, one tap at a time. Everything is encrypted: not even the server can read it.')}</p>
          {!loadAccount() ? <SignIn joining /> : <>
            <label class="c-label">{t('Your name')}<input value={me} maxLength={40} placeholder={t('How the others will see you')} onInput={e => setMe((e.target as HTMLInputElement).value)} /></label>
            <button class="c-btn primary" disabled={busy || !me.trim()} onClick={() => join()}>{busy ? t('Joining…') : t('Join {circle}', { circle: invite.name })}</button>
          </>}
        </div>
      ))}
      {!invite && !msg && <p class="muted">{t('Opening the invite…')}</p>}
      {msg && <p class="note">{msg}</p>}
    </div>
  )
}

// What each circle held when last seen, so one opens with it already in place
// (see warmFeed) instead of as a bare title that fills in a moment later.
const lastFeed = new Map<string, Feed>()
export const warmFeed = (id: string) => lastFeed.has(id) ? Promise.resolve() : keptFeed(id).then(f => { if (f) lastFeed.set(id, f) })

function CircleView({ id }: { id: string }) {
  const nav = useNav()
  const { settings, update } = useApp()
  const [info, setInfo] = useState(() => lastList?.find(c => c.id === id))
  const [feed, setShown] = useState(() => lastFeed.get(id))
  const setFeed = (f: Feed) => { lastFeed.set(id, f); setShown(f) }
  const [msg, setMsg] = useState('')
  const [invite, setInvite] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [showCode, setShowCode] = useState(false)
  // Let in with a code: look every few seconds (for two minutes at most)
  // until their phone finishes joining, so they show up here on their own.
  const [joining, setJoining] = useState<{ was: number; until: number }>()
  const [page, setPage] = useState<'shared' | 'people'>()
  const [limit, setLimit] = useState(PAGE)
  // What came in since you last looked shows first, marked, until you next
  // come back. Looking at it clears the dot.
  const [since] = useState(() => seenAt(id))
  // The name as it is now (someone in the circle may have changed it).
  const named = (name: string) => {
    setInfo(i => i ? { ...i, name } : { id, name, members: 0 })
    if (nav.sheet) nav.open({ id, name })
  }
  const load = () => loadFeed(id).then(f => {
    setFeed(f); setMsg(''); markSeen(id, newsIn(f, 0).latest, true); clearNotifications(id).catch(() => {})
    if (f.name && f.name !== info?.name) named(f.name)
  }, e => setMsg(message(e)))
  useEffect(() => {
    keptCircles().then(cs => setInfo(cs.find(c => c.id === id)))
    const kept = lastFeed.get(id)
    if (kept) markSeen(id, newsIn(kept, 0).latest)
    else keptFeed(id).then(f => { if (f) { setFeed(f); markSeen(id, newsIn(f, 0).latest) } })
    load()
    const back = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [id])
  useEvery(2500, async () => {
    if (!joining || Date.now() > joining.until) { setJoining(undefined); return true }
    const f = await loadFeed(id)
    setFeed(f)
    if (f.members.length > joining.was) { setJoining(undefined); setShowCode(false); return true }
  }, !!joining)
  useEffect(() => { if (info) document.title = `${info.name} · My Quiet Bible` }, [info])

  // One tap: make the link and open the share sheet. If the phone says the
  // tap was too long ago (Safari does, after a slow network), the button
  // turns into "Send invite link" and the next tap sends it at once.
  const sendInvite = async (link: string) => {
    const text = (info?.name ? t('Come read the word and pray with {circle} in My Quiet Bible. This private link is just for you: it works once, for 7 days.', { circle: info.name })
      : t('Come read the word and pray with my circle in My Quiet Bible. This private link is just for you: it works once, for 7 days.'))
      + ' ' + t('Already have My Quiet Bible? Copy this link and paste it in Circles there.')
    if (canShare) {
      try { await navigator.share({ title: 'My Quiet Bible', text, url: link }); setSent(true) } catch (e) {
        if ((e as Error).name !== 'AbortError') setInvite(link)
      }
    } else await copyText(link).then(() => { setSent(true); setMsg(t('Invite link copied. Paste it in a message to the person you’re inviting.')) }, () => setInvite(link))
  }
  const makeInvite = async () => {
    setBusy(true); setMsg(''); setSent(false)
    try { const link = await inviteLink(id); setInvite(link); await sendInvite(link) } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  const leave = async () => {
    setBusy(true)
    try {
      await leaveCircle(id)
      if (settings.shareStreaks.includes(id)) update({ shareStreaks: settings.shareStreaks.filter(x => x !== id) })
      nav.open()
    } catch (e) { setMsg(message(e)); setBusy(false) }
  }
  const nameOf = (mid: string) => mid === feed?.me ? t('You') : feed?.members.find(m => m.mid === mid)?.name ?? t('Someone who left')
  const fav = settings.version
  const news = feed ? newsIn(feed, since).items : undefined
  // A few days at a time, then a clear end: never an endless stack.
  const { days, more } = feed ? byDay(feed.items, news!, limit, dayAt) : { days: [], more: false }
  // A circle with only you in it starts on People, where the invite is.
  const tab = page ?? (feed && feed.members.length < 2 && !feed.items.length ? 'people' : 'shared')

  return (
    <div class="circles">
      {!nav.sheet && <h1><button class="settings-back" onClick={() => nav.open()}><BackIcon class="back-ico" /> {info?.name ?? t('Circle')}</button></h1>}
      {feed && (
        <div class="seg c-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'shared'} class={tab === 'shared' ? 'on' : ''} onClick={() => setPage('shared')}>{t('Shared')}</button>
          <button role="tab" aria-selected={tab === 'people'} class={tab === 'people' ? 'on' : ''} onClick={() => setPage('people')}>{t('People')}</button>
        </div>
      )}
      {msg && <p class="note small">{msg}</p>}
      {feed && tab === 'people' && <>
        <p class="c-members">{feed.members.map(m => m.mid === feed.me ? t('You') : m.name).join(', ')}</p>
        <Notify circle={id} name={info?.name} />
        <StreakBoard circle={id} name={info?.name} feed={feed} onChange={load} />
        {showCode ? <ShowCode circle={id} onDone={() => { setShowCode(false); load() }} onAllowed={() => setJoining({ was: feed?.members.length ?? 1, until: Date.now() + 120_000 })} /> : (
          <div class="c-card">
            <p class="c-card-title">{t('Invite someone')}</p>
            <div class="c-row c-two">
              <button class="c-btn primary" onClick={() => { setMsg(''); setPage('people'); setShowCode(true) }}>{t('Show a code')}</button>
              {invite && !sent
                ? <button class="c-btn" onClick={() => sendInvite(invite)}>{canShare ? t('Send the link') : t('Copy the link')}</button>
                : <button class="c-btn" disabled={busy} onClick={makeInvite}>{busy ? t('Making link…') : t('Send a link')}</button>}
            </div>
            <p class="muted small">{sent ? t('Link sent.') + ' ' : ''}{t('A code is for someone beside you or on a call. A link works from far away, once, for 7 days.')}</p>
          </div>
        )}
        <Rename circle={id} name={info?.name ?? ''} onDone={named} />
        <div class="c-foot">
          {leaving
            ? <div class="c-row"><button class="c-btn" onClick={() => setLeaving(false)}>{t('Stay')}</button><button class="c-btn danger" disabled={busy} onClick={leave}>{t('Leave and remove what I shared')}</button></div>
            : <button class="link small" onClick={() => setLeaving(true)}>{t('Leave this circle')}</button>}
        </div>
      </>}
      {feed && tab === 'shared' && <>
        {!feed.items.length && <p class="muted c-empty">{t('Nothing shared yet. While reading, select verses and tap Circle to share them, as a bookmark, or with your note. Prayers share from Your prayers.')}</p>}
        {days.map(d => (
          <section class={'c-day' + (d.day === 'new' ? ' c-day-new' : '')}>
            <h3 class="c-day-name">{d.day === 'new' ? t('New since you last looked') : dayName(d.day)}</h3>
            <ol class="c-feed">
              {d.items.map(item => <Item circle={id} item={item} mine={item.by === feed.me} me={feed.me} nameOf={nameOf} fav={fav} onChange={load} news={news!.get(item.id)} />)}
            </ol>
          </section>
        ))}
        {more
          ? <button class="c-btn c-earlier" onClick={() => setLimit(n => n + PAGE)}>{t('Show earlier days')}</button>
          : feed.items.length > 0 && <p class="c-end">{t('That’s everything shared in {circle}.', { circle: info?.name ?? t('this circle') })}</p>}
      </>}
    </div>
  )
}

/** The circle's name, which anyone in it can change for everyone. */
function Rename({ circle, name, onDone }: { circle: string; name: string; onDone: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async (e: Event) => {
    e.preventDefault()
    const next = value.trim()
    if (!next || next === name) { setEditing(false); return }
    setBusy(true); setErr('')
    try { await renameCircle(circle, next); onDone(next); setEditing(false) } catch (e) {
      setErr(navigator.onLine === false ? t('You’re offline. Try again once you’re connected.') : message(e))
    } finally { setBusy(false) }
  }
  return (
    <div class="c-card c-rename">
      {editing ? (
        <form onSubmit={save}>
          <label class="c-label">{t('Name of the circle')}<input value={value} maxLength={60} autoFocus onInput={e => setValue((e.target as HTMLInputElement).value)} /></label>
          <p class="muted small">{t('Everyone in the circle will see the new name.')}</p>
          <div class="c-row c-two">
            <button type="button" class="c-btn" onClick={() => { setEditing(false); setValue(name); setErr('') }}>{t('Cancel')}</button>
            <button class="c-btn primary" disabled={busy || !value.trim()}>{busy ? t('Saving…') : t('Save name')}</button>
          </div>
        </form>
      ) : (
        <div class="c-rename-row">
          <span class="c-rename-text"><span class="muted small">{t('Circle name')}</span><strong>{name || t('Circle')}</strong></span>
          <button class="c-btn" onClick={() => { setValue(name); setEditing(true) }}>{t('Rename')}</button>
        </div>
      )}
      {err && <p class="note small">{err}</p>}
    </div>
  )
}

/** How many things show at first, and each time you ask for earlier days. */
const PAGE = 8

/** "Today", "Yesterday", or the day itself. */
function dayName(day: number) {
  const today = dayOf(Date.now())
  if (day === today) return t('Today')
  if (day === dayOf(today - 12 * 3600e3)) return t('Yesterday')
  return new Date(day).toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric', ...(new Date(day).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}

/** Notifications for this circle, on this phone: one big switch. They say
 *  only "Something new in Family", never what, and put no number on the icon. */
function Notify({ circle, name = t('this circle') }: { circle: string; name?: string }) {
  const [support, setSupport] = useState(pushSupport)
  const [on, setOn] = useState(() => pushOn(circle))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // The server's key, fetched now, so the tap can go straight to the phone's question.
  useEffect(() => { if (support === 'ok' && !on) prepareKey().catch(() => {}) }, [])
  if (support === 'no') return null
  const toggle = async () => {
    // Started before anything else: an iPhone only asks "Allow
    // notifications?" straight from a tap.
    const doing = on ? turnOff(circle) : turnOn(circle)
    setBusy(true); setErr('')
    try { await doing; setOn(!on) } catch (e) {
      setSupport(pushSupport())
      setErr(navigator.onLine === false ? t('You’re offline. Try again once you’re connected.') : message(e))
    } finally { setBusy(false) }
  }
  return (
    <div class="c-card c-notify">
      {support === 'install' ? <>
        <p class="c-notify-head"><BellIcon class="c-notify-ico" /> <strong>{t('Notifications')}</strong></p>
        <p class="small">{tj('On iPhone, notifications only work once My Quiet Bible is on your Home Screen. Tap Share, then {add}, and open My Quiet Bible from there. Then turn them on here.', { add: <strong>{t('Add to Home Screen')}</strong> })}</p>
      </> : support === 'old' ? <>
        <p class="c-notify-head"><BellIcon class="c-notify-ico" /> <strong>{t('Notifications')}</strong></p>
        <p class="small">{t('Notifications need iOS 16.4 or newer. Update your iPhone in Settings → General → Software Update to turn them on.')}</p>
      </> : support === 'blocked' && !on ? <>
        <p class="c-notify-head"><BellIcon class="c-notify-ico" /> <strong>{t('Notifications')}</strong></p>
        <p class="small">{blockedHelp()} {t('Then come back and turn them on here.')}</p>
      </> : (
        <button class="c-switch-row" role="switch" aria-checked={on} disabled={busy} onClick={toggle}>
          <BellIcon class="c-notify-ico" />
          <span class="c-switch-text">
            <strong>{busy ? (on ? t('Turning off…') : t('Turning on…')) : t('Notify me')}</strong>
            <span class="muted small">{on
              ? t('On for this phone: a quiet notice when there’s something new in {circle}. It never shows what was shared.', { circle: name })
              : t('A quiet notice on this phone when someone in {circle} shares, replies, or prays with you.', { circle: name })}</span>
          </span>
          <span class={'c-switch' + (on ? ' on' : '')} aria-hidden="true"><span /></span>
        </button>
      )}
      {err && <p class="note small">{err}</p>}
    </div>
  )
}

/** Streaks, for those in the circle who chose to show them: days in a row
 *  reading and praying, longest first. Yours shows live from this device. */
function StreakBoard({ circle, name, feed, onChange }: { circle: string; name?: string; feed: Feed; onChange: () => void }) {
  const { settings, update } = useApp()
  const days = useDays()
  const on = settings.shareStreaks.includes(circle)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toggle = async () => {
    setBusy(true); setErr('')
    try {
      await shareStreak(circle, feed.me, !on)
      update({ shareStreaks: on ? settings.shareStreaks.filter(x => x !== circle) : [...settings.shareStreaks, circle] })
      onChange()
    } catch (e) { setErr(navigator.onLine === false ? t('You’re offline. Try again once you’re connected.') : message(e)) } finally { setBusy(false) }
  }
  const rows = feed.members
    .map(m => m.mid === feed.me ? (on ? { name: t('You'), me: true, ...streaks(days) } : undefined) : m.streak ? { name: m.name, me: false, ...streaks(m.streak) } : undefined)
    .filter(r => !!r)
    .sort((a, b) => b.read + b.pray - a.read - a.pray)
  const others = rows.filter(r => !r.me).length
  return (
    <div class="c-card c-streaks">
      {rows.length > 0 && (
        <ul class="c-streak-list" aria-label={t('Streaks')}>
          {rows.map(r => (
            <li class={r.me ? 'me' : ''}>
              <strong>{r.name}</strong>
              <span title={t('Days in a row reading')}>📖 {r.read}{r.readToday && <span class="streak-check" aria-label={t(', today')}>✓</span>}</span>
              <span title={t('Days in a row praying')}>🙏 {r.pray}{r.prayToday && <span class="streak-check" aria-label={t(', today')}>✓</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <label class="c-streak-toggle">
        <input type="checkbox" checked={on} disabled={busy} onChange={toggle} />
        <span>{name ? t('Show my streaks to {circle}', { circle: name }) : t('Show my streaks to this circle')}
          <span class="muted small"> · {on
            ? others ? t('Days in a row reading and praying, and whether you have today. Nothing else.') : t('Others see theirs here once they turn this on too.')
            : others ? t('See how each other is doing, and keep each other going.') : t('They’ll see how many days in a row you’ve read and prayed. Nothing else.')}</span>
        </span>
      </label>
      {err && <p class="note small">{err}</p>}
    </div>
  )
}

function Item({ circle, item, mine, me, nameOf, fav, onChange, news }: {
  circle: string; item: FeedItem; mine: boolean; me: string; nameOf: (mid: string) => string; fav: string; onChange: () => void
  /** what's new on it since you last looked */
  news?: News
}) {
  const { marks, setMarks, settings } = useApp()
  const b = item.body
  // Your own 🙏 and reactions show the moment you tap; the circle catches up.
  const [tapped, setTapped] = useState<{ prayed?: boolean; reacts?: Reaction[] }>({})
  useEffect(() => setTapped({}), [item])
  const prayed = tapped.prayed ?? item.amens.includes(me)
  const amens = prayed === item.amens.includes(me) ? item.amens : prayed ? [...item.amens, me] : item.amens.filter(m => m !== me)
  const reacts: Record<string, Reaction[]> = Object.fromEntries(Object.entries(item.reacts ?? {}).map(([m, x]) => [m, x.e]))
  if (tapped.reacts) reacts[me] = tapped.reacts
  const myReacts = reacts[me] ?? []
  const emoji = (r: Reaction | 'pray') => reactEmoji(r, settings.prayTone)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [tray, setTray] = useState(false)
  const [writing, setWriting] = useState(false)
  const [said, setSaid] = useState('')
  const [err, setErr] = useState('')
  const [kept, setKept] = useState('')
  const act = (fn: () => Promise<unknown>) => async () => {
    setBusy(true); setErr('')
    try { await fn(); onChange() } catch (e) { setErr(message(e)) } finally { setBusy(false) }
  }
  const send = act(async () => { await reply(circle, item.id, said.trim()); setSaid(''); setWriting(false) })
  const tap = (fn: () => Promise<unknown>, undo: () => void) => async () => {
    setErr('')
    try { await fn(); onChange() } catch (e) { undo(); setErr(message(e)) }
  }
  const pray = () => { setTapped(x => ({ ...x, prayed: !prayed })); tap(() => amen(circle, item.id, !prayed), () => setTapped(x => ({ ...x, prayed: undefined })))() }
  const toggle = (r: Reaction) => {
    const on = !myReacts.includes(r)
    const next = REACTS.filter(x => x === r ? on : myReacts.includes(x))
    setTapped(x => ({ ...x, reacts: next }))
    tap(() => react(circle, item.id, me, next, on), () => setTapped(x => ({ ...x, reacts: undefined })))()
  }
  // Who gave what, in the order of the buttons; nobody, nothing.
  const who = [['pray', amens] as const, ...REACTS.map(r => [r, Object.keys(reacts).filter(m => reacts[m].includes(r))] as const)].filter(([, ms]) => ms.length)
  // Never the sender's Bible: the reader's own, unless theirs lacks it.
  const shown = usePassage(b.verse, b.k === 'prayer' ? undefined : { text: b.text, version: b.version, size: b.size })
  // The passage as your Bible numbers it (the Psalms differ in some).
  const verse = shown?.at ?? b.verse
  const nav = useNav()
  const open = (v: PrayerVerse) => { nav.away(); go(readPath(shown?.version ?? fav, v.book, v.chapter, v.verses[0])) }
  const ref = (v: PrayerVerse) => <button class="link c-ref" onClick={() => open(v)}>{verseLabel(v)}{shown && <span class="muted small"> ({shown.version})</span>}</button>
  // Keep it as your own: a bookmark, or a copy of the note in your notes.
  const bookmarked = !!verse && verse.verses.every(n => marks[markKey(verse.book, verse.chapter, n)]?.b)
  const bookmark = () => {
    if (!verse) return
    const now = Date.now()
    setMarks(all => {
      const out = { ...all }
      for (const n of verse.verses) { const k = markKey(verse.book, verse.chapter, n); out[k] = tidy({ ...all[k], b: 1, t: now }) }
      return out
    })
    setKept(t('Bookmarked. It’s in your Saved.'))
  }
  const keepNote = () => {
    if (b.k !== 'note' || !verse) return
    setMarks(all => setNote(all, markKey(verse.book, verse.chapter, verse.verses[0]), newNoteId(), `${b.note}\n— ${nameOf(item.by)}`, Date.now(), verse.verses))
    setKept(t('Added to your notes on this verse.'))
  }
  const kind = b.k === 'bookmark' ? t('bookmarked') : b.k === 'note' ? t('wrote a note') : b.k === 'prayer' ? t('prayed') : t('shared')
  // New itself, or something new on it: a reply, or someone praying with you.
  const fresh = news && !news.item && (news.replies.size ? (news.replies.size === 1 ? t('New reply') : t('New replies'))
    : news.amens.size ? tn(news.amens.size, '{names} is praying with you', '{names} are praying with you', { names: [...news.amens].map(nameOf).join(', ') })
    : t('{emoji} from {names}', {
      names: [...news.reacts].map(nameOf).join(', '),
      emoji: REACTS.filter(r => [...news.reacts].some(m => reacts[m]?.includes(r))).map(emoji).join(' '),
    }))
  return (
    <li class={'c-item c-kind-' + b.k + (news ? ' c-new' : '')}>
      {fresh && <p class="c-new-word small">{fresh}</p>}
      <div class="c-item-head"><span>{news?.item && <span class="c-new-tag">{t('New')}</span>}<strong>{nameOf(item.by)}</strong> <span class="muted small">{kind}</span></span><span class="muted small">{when(dayAt(item), !!news || dayOf(dayAt(item)) !== dayOf(item.at))}</span></div>
      {b.k === 'prayer' ? <>
        <PrayerPlayer circle={circle} item={item} onError={setErr} />
        {b.note && <p class="c-note c-prayer-note">{b.note}</p>}
        {verse && <button class="link c-ref" onClick={() => open(verse)}>{t('With {verse}', { verse: verseLabel(verse) })}{shown && <span class="muted small"> ({shown.version})</span>}</button>}
        {verse && <Passage shown={shown} small from={nameOf(item.by)} />}
        {b.verses?.slice(1).map(v => <MoreVerse verse={v} />)}
      </> : b.k === 'note' ? <>
        <p class="c-note c-note-main">{b.note}</p>
        <Passage shown={shown} small from={nameOf(item.by)} />
        {ref(verse!)}
      </> : <>
        {b.k === 'bookmark' && <BookmarkIcon size={18} class="c-bm" />}
        <Passage shown={shown} from={nameOf(item.by)} />
        {ref(verse!)}
        {b.note && <p class="c-note">{b.note}</p>}
      </>}
      {item.replies.length > 0 && (
        <ul class="c-replies">
          {item.replies.map(r => (
            <li class={news?.replies.has(r.id) ? 'c-new-reply' : ''}><strong>{nameOf(r.by)}</strong> {r.text}
              {r.by === me && <button class="link small" disabled={busy} aria-label={t('Remove your reply')} onClick={act(() => removeReply(circle, item.id, r.id))}>{t('Remove')}</button>}</li>
          ))}
        </ul>
      )}
      {writing && (
        <div class="c-reply">
          <textarea rows={2} maxLength={1000} value={said} placeholder={b.k === 'prayer' ? t('Pray with them in a few words…') : t('Write back…')}
            autoFocus onInput={e => setSaid((e.target as HTMLTextAreaElement).value)} />
          <div class="c-row">
            <button class="c-btn small primary" disabled={busy || !said.trim()} onClick={send}>{busy ? t('Sending…') : t('Send')}</button>
            <button class="c-btn small" onClick={() => { setWriting(false); setSaid('') }}>{t('Cancel')}</button>
          </div>
        </div>
      )}
      {/* Quiet until asked: who prayed or reacted, in one small line, and a
          single button that opens the reactions and the rest. */}
      {!writing && (
        <div class="c-respond-row">
          <p class="c-who small">
            {who.map(([r, ms]) => <span class="c-who-group"><span aria-label={r === 'pray' ? t('Praying') : REACT_WORDS[r]()}>{emoji(r)}</span> {ms.map(nameOf).join(', ')}</span>)}
          </p>
          <button class={'c-respond' + (tray ? ' on' : '')} aria-expanded={tray} onClick={() => { setTray(!tray); setConfirm(false) }}>{tray ? t('Done') : t('Respond')}</button>
        </div>
      )}
      {tray && !writing && (
        <div class="c-tray">
          <div class="c-reacts" role="group" aria-label={t('Reactions')}>
            <button class={'c-react' + (prayed ? ' on' : '')} aria-pressed={prayed} onClick={() => { pray(); setTray(false) }}
              aria-label={prayed ? t('Praying') : t('Pray with')} title={prayed ? t('Praying') : t('Pray with')}>
              <span class="c-react-emoji" aria-hidden="true">{emoji('pray')}</span>
            </button>
            {REACTS.map(r => {
              const on = myReacts.includes(r)
              return (
                <button class={'c-react' + (on ? ' on' : '')} aria-pressed={on} onClick={() => { toggle(r); setTray(false) }} aria-label={REACT_WORDS[r]()} title={REACT_WORDS[r]()}>
                  <span class="c-react-emoji" aria-hidden="true">{emoji(r)}</span>
                </button>
              )
            })}
          </div>
          <div class="c-item-foot">
            <button class="c-amen" onClick={() => { setWriting(true); setTray(false) }}>{t('Reply')}</button>
            {!mine && verse && b.k !== 'prayer' && (b.k === 'note'
              ? <button class="c-amen" onClick={() => { keepNote(); setTray(false) }}>{t('Keep note')}</button>
              : !bookmarked && <button class="c-amen" onClick={() => { bookmark(); setTray(false) }}>{t('Bookmark')}</button>)}
            <span class="spacer" />
            {mine && (confirm
              ? <><button class="c-btn small" onClick={() => setConfirm(false)}>{t('Keep')}</button><button class="c-btn small danger" disabled={busy} onClick={act(() => removeShared(circle, item.id))}>{t('Remove for everyone')}</button></>
              : <button class="link small" onClick={() => setConfirm(true)}>{t('Remove')}</button>)}
          </div>
        </div>
      )}
      {kept && <p class="muted small">{kept}</p>}
      {err && <p class="note small">{err}</p>}
    </li>
  )
}

/** Love, strength, encouragement. The hands take the skin tone picked for 🙏. */
const reactEmoji = (r: Reaction | 'pray', tone: string) =>
  r === 'pray' ? '🙏' + tone : r === 'love' ? '❤️' : r === 'strength' ? '💪' + tone : '🙌' + tone
const REACT_WORDS: Record<Reaction, () => string> = {
  love: () => t('Love'), strength: () => t('Strength'), cheer: () => t('Encouragement'),
}

function PrayerPlayer({ circle, item, onError }: { circle: string; item: FeedItem; onError: (m: string) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [pos, setPos] = useState(0)
  const audio = useRef<{ el: HTMLAudioElement; urls: string[] }>()
  const release = () => {
    const a = audio.current
    if (a) { a.el.pause(); a.urls.forEach(u => URL.revokeObjectURL(u)); audio.current = undefined }
    setState('idle'); setPos(0)
  }
  useEffect(() => release, [])
  const play = async () => {
    if (state !== 'idle') { release(); return }
    setState('loading')
    let parts
    try { parts = await prayerAudio(circle, item) } catch (e) { setState('idle'); onError(message(e)); return }
    const ms = item.body.k === 'prayer' ? item.body.parts.map(p => p.ms) : []
    // One plain file per part: an iPhone stops a fragmented recording early.
    const urls = parts.map(p => URL.createObjectURL(new Blob([playable(p.audio, p.type)], { type: p.type })))
    const el = new Audio()
    let i = 0, offset = 0
    el.ontimeupdate = () => setPos(offset + el.currentTime * 1000)
    el.onended = () => {
      if (++i >= urls.length) { release(); return }
      offset += ms[i - 1] ?? 0
      el.src = urls[i]; el.play().catch(release)
    }
    audio.current = { el, urls }
    setState('playing')
    el.src = urls[0]
    el.play().catch(release)
  }
  const total = item.body.k === 'prayer' ? item.body.ms : 0
  return (
    <div class="c-prayer">
      <button class="c-play" aria-label={state === 'idle' ? t('Play this prayer') : t('Stop')} onClick={play}>
        {state === 'idle'
          ? <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
          : <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>}
      </button>
      <span>{t('A prayer')} <span class="muted">· {state === 'loading' ? t('Opening…') : state === 'playing' ? `${duration(pos)} / ${duration(total)}` : duration(total)}</span></span>
    </div>
  )
}

/** Share verses, a bookmark, a note or a prayer with one of your circles:
 *  one tap to choose the circle (if there's more than one), and Share. */
export function ShareSheet({ request, onClose }: { request: ShareRequest; onClose: () => void }) {
  const { marks, setMarks, data, settings } = useApp()
  const [list, setList] = useState<CircleInfo[]>()
  // One circle or several: each gets its own copy.
  const [picks, setPicks] = useState<string[]>([])
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)
  const [what, setWhat] = useState('')
  // A day's prayers: each one shared on its own, so it keeps the day it was
  // prayed. What already went to a circle isn't sent there again on a retry.
  const many = 'prayers' in request
  const sent = useRef(new Set<string>())
  // Your notes on exactly these verses (or covering the one verse).
  const v = 'verse' in request ? request.verse : undefined
  const notes = v ? notesCovering(marks, v.book, v.chapter, v.verses[0]).filter(x => v.verses.length === 1 || x.verses.join() === v.verses.join()) : []
  const bookmarked = !!v && v.verses.every(n => marks[markKey(v.book, v.chapter, n)]?.b)
  const [kind, setKind] = useState<'verse' | 'bookmark' | 'note'>(() => 'verse' in request && request.note ? 'note' : bookmarked ? 'bookmark' : 'verse')
  const [noteId, setNoteId] = useState(() => (notes.find(x => 'verse' in request && x.n === request.note) ?? notes[notes.length - 1])?.id ?? '')
  const theNote = 'verse' in request && request.note && !notes.some(x => x.id === noteId) ? request.note : notes.find(x => x.id === noteId)?.n
  useEffect(() => {
    keptCircles().then(cs => { setList(cs); setPicks(cs[0] ? [cs[0].id] : []) })
    if ('prayers' in request) Promise.all(request.prayers.map(id => prayers.get(id))).then(ps => {
      const kept = ps.filter(p => !!p)
      setWhat(`${tn(kept.length, '{n} prayer', '{n} prayers')} · ${duration(kept.reduce((n, p) => n + p!.ms, 0))}`)
    })
    else if ('prayer' in request) prayers.get(request.prayer).then(p => setWhat(p ? `${t('Your prayer')} · ${duration(p.ms)}${versesOf(p).map(v => ` · ${verseLabel(v)}`).join('')}` : ''))
    else setWhat(verseLabel(request.verse))
  }, [])
  const chosen = (list ?? []).filter(c => picks.includes(c.id))
  const toggle = (id: string) => setPicks(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const send = async () => {
    if (!picks.length) return
    setBusy(true); setMsg('')
    try {
      for (const pick of picks) {
        // The reference goes in standard numbering, so each reader finds it
        // in their own Bible (see lib/passage), with how many verses your
        // Bible has in that chapter, so one that numbers it differently
        // doesn't show them the wrong verse.
        if ('prayers' in request) {
          const b = await data.bible(settings.version).catch(() => undefined)
          for (const [i, id] of request.prayers.entries()) {
            if (sent.current.has(`${pick}/${id}`)) continue
            // Gone since the list was opened: nothing to send.
            if (!await prayers.get(id)) continue
            // The few words go with the first one only.
            await sharePrayer(pick, id, i ? '' : words.trim(), v => toStandard(b, v))
            sent.current.add(`${pick}/${id}`)
          }
        } else if ('prayer' in request) {
          const b = await data.bible(settings.version).catch(() => undefined)
          await sharePrayer(pick, request.prayer, words.trim(), v => toStandard(b, v))
        } else {
          const b = await data.bible(request.version).catch(() => undefined), v = request.verse
          const size = renumbered(b, v.book) ? 0 : chapterSize(b, v.book, v.chapter)
          await shareVerse(pick, kind, toStandard(b, v), request.version, request.text, kind === 'note' ? theNote : words.trim(), size)
        }
        // Shared already: a second tap won't send it there twice.
        setPicks(p => p.filter(x => x !== pick))
      }
      // Shared as a bookmark is one of yours too, if it wasn't yet.
      if ('verse' in request && kind === 'bookmark' && !bookmarked) {
        const v = request.verse, now = Date.now()
        setMarks(all => {
          const out = { ...all }
          for (const n of v.verses) { const k = markKey(v.book, v.chapter, n); out[k] = tidy({ ...all[k], b: 1, t: now }) }
          return out
        })
      }
      setDone(true)
      setTimeout(onClose, 900)
    } catch (e) { setMsg(navigator.onLine === false ? t('You’re offline. Share again once you’re connected.') : message(e)) } finally { setBusy(false) }
  }
  const canNote = notes.length > 0 || ('verse' in request && !!request.note)
  return (
    <Sheet title={t('Share with your circle')} onClose={onClose}>
      <div class="c-share">
        <p><strong>{what}</strong></p>
        {'verse' in request && <>
          <div class="seg c-pick" role="radiogroup" aria-label={t('Share as')}>
            <button role="radio" aria-checked={kind === 'verse'} class={kind === 'verse' ? 'on' : ''} onClick={() => setKind('verse')}>{t('Verse')}</button>
            <button role="radio" aria-checked={kind === 'bookmark'} class={kind === 'bookmark' ? 'on' : ''} onClick={() => setKind('bookmark')}>{t('Bookmark')}</button>
            {canNote && <button role="radio" aria-checked={kind === 'note'} class={kind === 'note' ? 'on' : ''} onClick={() => setKind('note')}>{t('My note')}</button>}
          </div>
          {kind === 'note' && notes.length > 1 && (
            <ul class="c-notes">{notes.map(x => (
              <li><label><input type="radio" name="c-note" checked={noteId === x.id} onChange={() => setNoteId(x.id)} /> <span>{x.n}</span></label></li>
            ))}</ul>
          )}
          {kind === 'note' && notes.length <= 1 && theNote && <p class="c-note c-note-main">{theNote}</p>}
          <p class="c-quote small">{request.text}</p>
          {kind === 'bookmark' && <p class="muted small">{bookmarked ? t('They can bookmark it too, with one tap.') : t('It goes in your bookmarks too. They can bookmark it with one tap.')}</p>}
        </>}
        {list && list.length > 1 && (
          <div class="c-circles-pick" role="group" aria-label={t('Circles')}>
            {list.map(c => <button aria-pressed={picks.includes(c.id)} class={picks.includes(c.id) ? 'on' : ''} onClick={() => toggle(c.id)}>{picks.includes(c.id) && '✓ '}{c.name}</button>)}
          </div>
        )}
        {list && list.length > 1 && picks.length < 2 && <p class="muted small c-pick-more">{t('Tap more circles to share with them too')}</p>}
        {kind !== 'note' && <textarea rows={2} maxLength={1000} value={words} placeholder={many ? t('Add a note about these prayers (optional)') : 'prayer' in request ? t('Add a note about this prayer (optional)') : t('Add a few words (optional)')} onInput={e => setWords((e.target as HTMLTextAreaElement).value)} />}
        {many && <p class="muted small">{chosen.length ? t('Everyone in {circle} will be able to hear these prayers.', { circle: chosen.map(c => c.name).join(', ') }) : t('Everyone in the circle will be able to hear these prayers.')}</p>}
        {'prayer' in request && <p class="muted small">{chosen.length ? t('Everyone in {circle} will be able to hear this prayer.', { circle: chosen.map(c => c.name).join(', ') }) : t('Everyone in the circle will be able to hear this prayer.')}</p>}
        <button class="c-btn primary" disabled={busy || done || !picks.length || (kind === 'note' && !theNote)} onClick={send}>{done ? t('Shared ✓') : busy ? t('Sharing…')
          : chosen.length === 2 ? t('Share with {a} and {b}', { a: chosen[0].name, b: chosen[1].name })
          : chosen.length > 1 ? t('Share with {n} circles', { n: chosen.length }) : chosen.length ? t('Share with {circle}', { circle: chosen[0].name }) : t('Share with circle')}</button>
        {msg && <p class="note small">{msg}</p>}
        {list && !list.length && <p class="muted">{t('You’re not in a circle on this device yet. Open Circles, beside 🙏.')}</p>}
      </div>
    </Sheet>
  )
}
