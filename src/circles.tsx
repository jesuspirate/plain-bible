// Circles: a few people sharing what they read and pray. #/circles lists
// yours, #/circles/<id> shows one, and #/join?… is an invite link. Loaded
// only when one of these opens, or when something is shared.
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  accountKeyCode, amen, CircleInfo, createCircle, Feed, FeedItem, Invite, inviteLink, joinCircle, keptCircles, keptFeed,
  leaveCircle, listCircles, loadFeed, parseInviteLink, prayerAudio, readInvite, removeReply, removeShared, reply, sharePrayer, shareVerse,
} from './lib/circles'
import { duration, prayers } from './lib/prayers'
import { PrayerVerse, verseLabel } from './lib/prayerVerses'
import { loadAccount, noPasskey, prepareSignIn, register, signIn, SYNC_URL } from './lib/sync'
import { markKey, newNoteId, notesCovering, setNote, tidy } from './lib/marks'
import { canShare, copyText } from './lib/native'
import { go, readPath, Route, ShareRequest, useApp } from './state'
import { BookmarkIcon } from './icons'
import { Sheet } from './ui'
import './circles.css'

const NAME = 'plain-bible:circle-name'
const lastName = () => { try { return localStorage.getItem(NAME) || '' } catch { return '' } }
const keepName = (s: string) => { try { localStorage.setItem(NAME, s) } catch { /* ignore */ } }
const message = (e: unknown) => {
  const m = (e as Error).message
  return m === 'Cancelled' ? 'The passkey request was cancelled. Tap to try again.' : m
}
const when = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function CirclesPage({ route }: { route: Route }) {
  useEffect(() => { document.title = 'Circles · Quiet Bible' }, [])
  if (!SYNC_URL) return <div class="circles"><h1>Circles</h1><p class="muted">Circles aren’t available in this copy of the app.</p></div>
  // An invite opens even before you have an account: it says who it's
  // from, then makes the account right there, without leaving the page.
  if (route.path[0] === 'join') return <Join id={route.params.get('i') ?? ''} secret={route.params.get('k') ?? ''} />
  if (!loadAccount()) return (
    <div class="circles">
      <h1>Circles</h1>
      <p>Share the verses you read and the prayers you pray with a few people you choose: family, a friend, a small group.</p>
      <p class="muted">Everything you share is encrypted on your device, so only the people in your circle can read or hear it.</p>
      <SignIn />
    </div>
  )
  return route.path[1] ? <CircleView id={route.path[1]} /> : <CircleList />
}

/** Make an account or sign in, here, with a passkey. No email, no password. */
function SignIn({ joining }: { joining?: boolean }) {
  const { sync } = useApp()
  const [working, setWorking] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { if (navigator.onLine !== false) prepareSignIn() }, [])
  if (typeof PublicKeyCredential === 'undefined') return <p class="note">This browser can’t use passkeys, which circles need. Try Safari or Chrome.</p>
  const act = (label: string, fn: () => Promise<string | undefined>) => async () => {
    setWorking(label); setMsg('')
    try { const t = await fn(); if (t) sync.signedIn(t) } catch (e) {
      const m = (e as Error).message
      setMsg(m === 'Cancelled' ? 'The passkey request was cancelled. Tap to try again.' : m)
      if (label === 'login') prepareSignIn()
    } finally { setWorking('') }
  }
  return (
    <div class="c-card">
      <p class="small">{joining ? 'To join, make a free account with a passkey' : 'Circles need a free account with a passkey'}: your phone unlocks it with Face ID, a fingerprint or your screen lock. No email, no password.</p>
      <div class="c-row">
        <button class="c-btn primary" disabled={!!working} onClick={act('create', () => register())}>{working === 'create' ? 'Waiting for passkey…' : 'Create account'}</button>
        <button class="c-btn" disabled={!!working} onClick={act('login', signIn)}>{working === 'login' ? 'Waiting for passkey…' : 'I have one: sign in'}</button>
      </div>
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

/** The account key typed in, for a device whose passkey can't unlock it. */
function CodeEntry({ busy, onCode, onCancel }: { busy: boolean; onCode: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState('')
  return (
    <div class="c-card">
      <p class="muted">This device can’t unlock your circles by itself. Easiest: on a device where they open, tap Settings → Link another device and open that link here. Or there, go to Circles → Show my key, and type it below.</p>
      <input class="c-code" value={code} onInput={e => setCode((e.target as HTMLInputElement).value)} placeholder="Your key"
        autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellcheck={false} />
      <div class="c-row">
        <button class="c-btn primary" disabled={busy || !code.trim()} onClick={() => onCode(code)}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        <button class="c-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function CircleList() {
  const [list, setList] = useState<CircleInfo[]>()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [needCode, setNeedCode] = useState<'list' | 'create' | ''>('')
  const [making, setMaking] = useState(false)
  const [name, setName] = useState('')
  const [me, setMe] = useState(lastName)
  const [key, setKey] = useState('')
  const [locked, setLocked] = useState(0)

  const load = async (unlock = false, code?: string) => {
    setBusy(true); setMsg('')
    try {
      const r = await listCircles(unlock, code)
      if (r === 'needCode') setNeedCode('list')
      else { setList(r.circles); setLocked(r.locked); setNeedCode('') }
    } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  // What's kept shows at once (and offline); the server fills in the rest.
  // Unlocking can ask for the passkey, so that waits for a tap.
  useEffect(() => { keptCircles().then(k => { setList(k); if (navigator.onLine !== false) load() }) }, [])
  const unlock = () => load(true)

  const create = async (code?: string) => {
    if (!name.trim() || !me.trim()) return
    setBusy(true); setMsg('')
    try {
      keepName(me.trim())
      const id = await createCircle(name.trim(), me.trim(), code)
      if (id === 'needCode') { setNeedCode('create'); return }
      go(`circles/${id}`)
    } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }

  return (
    <div class="circles">
      <h1>Circles</h1>
      <p class="muted">Share verses and prayers with a few people you choose. Everything is encrypted on your device; only your circle can read or hear it.</p>
      {needCode
        ? <CodeEntry busy={busy} onCode={c => needCode === 'create' ? create(c) : load(true, c)} onCancel={() => setNeedCode('')} />
        : <>
          {locked > 0 && (
            <div class="c-card">
              <p class="small">{locked === 1 ? 'One circle isn’t' : `${locked} circles aren’t`} unlocked on this device yet.</p>
              <button class="c-btn primary" disabled={busy} onClick={unlock}>{noPasskey() ? (busy ? 'Unlocking…' : 'Unlock') : busy ? 'Waiting for passkey…' : 'Unlock with my passkey'}</button>
            </div>
          )}
          {list?.length ? (
            <ul class="c-list">
              {list.map(c => (
                <li><a href={`#/circles/${c.id}`}><strong>{c.name}</strong><span class="muted">{c.members === 1 ? 'Just you so far' : `${c.members} people`} ›</span></a></li>
              ))}
            </ul>
          ) : list && !busy && !locked && <p>You’re not in a circle yet. Make one, then invite people with a link.</p>}
          {making ? (
            <div class="c-card">
              <label class="c-label">Name of the circle<input value={name} maxLength={60} placeholder="Family, Tuesday group…" onInput={e => setName((e.target as HTMLInputElement).value)} /></label>
              <label class="c-label">Your name<input value={me} maxLength={40} placeholder="How the others will see you" onInput={e => setMe((e.target as HTMLInputElement).value)} /></label>
              <div class="c-row">
                <button class="c-btn primary" disabled={busy || !name.trim() || !me.trim()} onClick={() => create()}>{busy ? 'Making…' : 'Make circle'}</button>
                <button class="c-btn" onClick={() => setMaking(false)}>Cancel</button>
              </div>
            </div>
          ) : <button class="c-btn primary" onClick={() => setMaking(true)}>New circle</button>}
          <PasteInvite />
        </>}
      {msg && <p class="note small">{msg} {!needCode && <button class="link" onClick={() => load()}>Try again</button>}</p>}
      <div class="c-foot">
        {key
          ? <><p class="c-key"><code>{key.replace(/-/g, '-​')}</code></p>
            <p class="muted small">Only needed on a device whose passkey can’t unlock your circles. Keep it private: it opens your circles and your synced prayers.</p></>
          : <button class="link small" onClick={() => accountKeyCode().then(k => setKey(k || 'Open a circle on this device first.'))}>Show my key</button>}
      </div>
    </div>
  )
}

/** An invite link opened somewhere else (say in Safari, while you read in
 *  the app on your Home Screen) can be pasted here instead. */
function PasteInvite() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const use = (s: string) => {
    const l = parseInviteLink(s)
    if (l) go(`join?i=${l.i}&k=${l.k}`)
    else setMsg('That isn’t a whole invite link. Copy it again from the message.')
  }
  const paste = async () => {
    try { const s = await navigator.clipboard.readText(); setText(s); use(s) } catch { setOpen(true) }
  }
  if (!open) return <p class="c-paste"><button class="link small" onClick={() => { setOpen(true); paste() }}>Have an invite link? Paste it</button></p>
  return (
    <div class="c-row c-paste">
      <input class="c-code" value={text} placeholder="Paste the invite link" onInput={e => { setText((e.target as HTMLInputElement).value); setMsg('') }}
        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellcheck={false} />
      <button class="c-btn" disabled={!text.trim()} onClick={() => use(text)}>Open</button>
      {msg && <p class="note small">{msg}</p>}
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
    if (!id || !secret) { setMsg('This invite link is incomplete. Ask for it to be sent again.'); return }
    readInvite(id, secret).then(i => { if (i.already) go(`circles/${i.circle}`, true); else setInvite(i) }, e => setMsg(message(e)))
  }, [id, secret])
  const join = async (code?: string) => {
    if (!invite || !me.trim()) return
    setBusy(true); setMsg('')
    try {
      keepName(me.trim())
      const r = await joinCircle(id, invite, me.trim(), code)
      if (r === 'needCode') { setNeedCode(true); return }
      go(`circles/${invite.circle}`, true)
    } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  return (
    <div class="circles">
      <h1>Join a circle</h1>
      {invite && (needCode ? <CodeEntry busy={busy} onCode={join} onCancel={() => setNeedCode(false)} /> : (
        <div class="c-card">
          <p>{invite.by ? <><strong>{invite.by}</strong> invited you to </> : 'You’re invited to '}<strong>{invite.name}</strong>
            <span class="muted"> · {invite.members === 1 ? '1 person' : `${invite.members} people`}</span></p>
          <p class="muted small">A private circle to read the word and pray together. You’ll see what they share, and they’ll see only what you choose to share, one tap at a time. Everything is encrypted: not even the server can read it.</p>
          {!loadAccount() ? <SignIn joining /> : <>
            <label class="c-label">Your name<input value={me} maxLength={40} placeholder="How the others will see you" onInput={e => setMe((e.target as HTMLInputElement).value)} /></label>
            <button class="c-btn primary" disabled={busy || !me.trim()} onClick={() => join()}>{busy ? 'Joining…' : `Join ${invite.name}`}</button>
          </>}
        </div>
      ))}
      {!invite && !msg && <p class="muted">Opening the invite…</p>}
      {msg && <p class="note">{msg}</p>}
    </div>
  )
}

function CircleView({ id }: { id: string }) {
  const { settings } = useApp()
  const [info, setInfo] = useState<CircleInfo>()
  const [feed, setFeed] = useState<Feed>()
  const [msg, setMsg] = useState('')
  const [invite, setInvite] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const load = () => loadFeed(id).then(f => { setFeed(f); setMsg('') }, e => setMsg(message(e)))
  useEffect(() => {
    keptCircles().then(cs => setInfo(cs.find(c => c.id === id)))
    keptFeed(id).then(f => f && setFeed(f))
    load()
    const back = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [id])
  useEffect(() => { if (info) document.title = `${info.name} · Quiet Bible` }, [info])

  // One tap: make the link and open the share sheet. If the phone says the
  // tap was too long ago (Safari does, after a slow network), the button
  // turns into "Send invite link" and the next tap sends it at once.
  const sendInvite = async (link: string) => {
    const text = `Come read the word and pray with ${info?.name ?? 'my circle'} in Quiet Bible. This private link is just for you: it works once, for 7 days.`
    if (canShare) {
      try { await navigator.share({ title: 'Quiet Bible', text, url: link }); setSent(true) } catch (e) {
        if ((e as Error).name !== 'AbortError') setInvite(link)
      }
    } else await copyText(link).then(() => { setSent(true); setMsg('Invite link copied. Paste it in a message to the person you’re inviting.') }, () => setInvite(link))
  }
  const makeInvite = async () => {
    setBusy(true); setMsg(''); setSent(false)
    try { const link = await inviteLink(id); setInvite(link); await sendInvite(link) } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  const leave = async () => {
    setBusy(true)
    try { await leaveCircle(id); go('circles', true) } catch (e) { setMsg(message(e)); setBusy(false) }
  }
  const nameOf = (mid: string) => mid === feed?.me ? 'You' : feed?.members.find(m => m.mid === mid)?.name ?? 'Someone who left'
  const fav = settings.favorite || settings.version

  return (
    <div class="circles">
      <h1><button class="settings-back" onClick={() => go('circles')}><span aria-hidden="true">‹</span> {info?.name ?? 'Circle'}</button></h1>
      {feed && <p class="muted small">{feed.members.map(m => m.mid === feed.me ? 'You' : m.name).join(', ')}</p>}
      <div class="c-row">
        {invite && !sent
          ? <button class="c-btn primary" onClick={() => sendInvite(invite)}>{canShare ? 'Send invite link' : 'Copy invite link'}</button>
          : <button class="c-btn" disabled={busy} onClick={makeInvite}>{busy ? 'Making link…' : sent ? 'Invite someone else' : 'Invite someone'}</button>}
      </div>
      <p class="muted small">{sent ? 'Sent. ' : ''}Each invite link lets one person in and works for 7 days, so send it only to the person you mean.</p>
      {msg && <p class="note small">{msg}</p>}
      {feed && !feed.items.length && <p class="muted c-empty">Nothing shared yet. While reading, select verses and tap Circle to share them, as a bookmark, or with your note. Prayers share from Your prayers.</p>}
      <ol class="c-feed">
        {feed?.items.map(item => <Item circle={id} item={item} mine={item.by === feed.me} me={feed.me} nameOf={nameOf} fav={fav} onChange={load} />)}
      </ol>
      <div class="c-foot">
        {leaving
          ? <div class="c-row"><button class="c-btn" onClick={() => setLeaving(false)}>Stay</button><button class="c-btn danger" disabled={busy} onClick={leave}>Leave and remove what I shared</button></div>
          : <button class="link small" onClick={() => setLeaving(true)}>Leave this circle</button>}
      </div>
    </div>
  )
}

function Item({ circle, item, mine, me, nameOf, fav, onChange }: {
  circle: string; item: FeedItem; mine: boolean; me: string; nameOf: (mid: string) => string; fav: string; onChange: () => void
}) {
  const { marks, setMarks } = useApp()
  const b = item.body
  const prayed = item.amens.includes(me)
  const names = item.amens.map(nameOf)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [writing, setWriting] = useState(false)
  const [said, setSaid] = useState('')
  const [err, setErr] = useState('')
  const [kept, setKept] = useState('')
  const act = (fn: () => Promise<unknown>) => async () => {
    setBusy(true); setErr('')
    try { await fn(); onChange() } catch (e) { setErr(message(e)) } finally { setBusy(false) }
  }
  const send = act(async () => { await reply(circle, item.id, said.trim()); setSaid(''); setWriting(false) })
  const verse = b.verse
  const open = (v: PrayerVerse) => go(readPath(fav, v.book, v.chapter, v.verses[0]))
  const ref = (v: PrayerVerse) => <button class="link c-ref" onClick={() => open(v)}>{verseLabel(v)}{b.k !== 'prayer' && b.version && <span class="muted small"> ({b.version})</span>}</button>
  // Keep it as your own: a bookmark, or a copy of the note in your notes.
  const bookmarked = !!verse && verse.verses.every(n => marks[markKey(verse.book, verse.chapter, n)]?.b)
  const bookmark = () => {
    if (!verse) return
    const t = Date.now()
    setMarks(all => {
      const out = { ...all }
      for (const n of verse.verses) { const k = markKey(verse.book, verse.chapter, n); out[k] = tidy({ ...all[k], b: 1, t }) }
      return out
    })
    setKept('Bookmarked. It’s in your Saved.')
  }
  const keepNote = () => {
    if (b.k !== 'note') return
    setMarks(all => setNote(all, markKey(b.verse.book, b.verse.chapter, b.verse.verses[0]), newNoteId(), `${b.note}\n— ${nameOf(item.by)}`, Date.now(), b.verse.verses))
    setKept('Added to your notes on this verse.')
  }
  const kind = b.k === 'bookmark' ? 'bookmarked' : b.k === 'note' ? 'wrote a note' : b.k === 'prayer' ? 'prayed' : 'shared'
  return (
    <li class={'c-item c-kind-' + b.k}>
      <div class="c-item-head"><span><strong>{nameOf(item.by)}</strong> <span class="muted small">{kind}</span></span><span class="muted small">{when(item.at)}</span></div>
      {b.k === 'prayer' ? <>
        <PrayerPlayer circle={circle} item={item} onError={setErr} />
        {verse && <button class="link c-ref" onClick={() => open(verse)}>With {verseLabel(verse)}</button>}
        {b.note && <p class="c-note">{b.note}</p>}
      </> : b.k === 'note' ? <>
        <p class="c-note c-note-main">{b.note}</p>
        {b.text && <p class="c-quote small">{b.text}</p>}
        {ref(b.verse)}
      </> : <>
        {b.k === 'bookmark' && <BookmarkIcon size={18} class="c-bm" />}
        <p class="c-quote">{b.text}</p>
        {ref(b.verse)}
        {b.note && <p class="c-note">{b.note}</p>}
      </>}
      {item.replies.length > 0 && (
        <ul class="c-replies">
          {item.replies.map(r => (
            <li><strong>{nameOf(r.by)}</strong> {r.text}
              {r.by === me && <button class="link small" disabled={busy} aria-label="Remove your reply" onClick={act(() => removeReply(circle, item.id, r.id))}>Remove</button>}</li>
          ))}
        </ul>
      )}
      {writing && (
        <div class="c-reply">
          <textarea rows={2} maxLength={1000} value={said} placeholder={b.k === 'prayer' ? 'Pray with them in a few words…' : 'Write back…'}
            autoFocus onInput={e => setSaid((e.target as HTMLTextAreaElement).value)} />
          <div class="c-row">
            <button class="c-btn small primary" disabled={busy || !said.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
            <button class="c-btn small" onClick={() => { setWriting(false); setSaid('') }}>Cancel</button>
          </div>
        </div>
      )}
      <div class="c-item-foot">
        <button class={'c-amen' + (prayed ? ' on' : '')} aria-pressed={prayed} disabled={busy} onClick={act(() => amen(circle, item.id, !prayed))}
          title={names.length ? `Praying with you: ${names.join(', ')}` : 'Praying with you'}>
          🙏 {prayed ? 'Praying' : 'Pray with'}{names.length ? ` · ${names.length}` : ''}
        </button>
        {!writing && <button class="c-amen" onClick={() => setWriting(true)}>Reply</button>}
        {!mine && verse && b.k !== 'prayer' && (b.k === 'note'
          ? <button class="link small" onClick={keepNote}>Keep note</button>
          : !bookmarked && <button class="link small" onClick={bookmark}>Bookmark</button>)}
        <span class="spacer" />
        {mine && (confirm
          ? <><button class="c-btn small" onClick={() => setConfirm(false)}>Keep</button><button class="c-btn small danger" disabled={busy} onClick={act(() => removeShared(circle, item.id))}>Remove for everyone</button></>
          : <button class="link small" onClick={() => setConfirm(true)}>Remove</button>)}
      </div>
      {names.length > 0 && <p class="muted small c-who">Praying: {names.join(', ')}</p>}
      {kept && <p class="muted small">{kept}</p>}
      {err && <p class="note small">{err}</p>}
    </li>
  )
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
    const urls = parts.map(p => URL.createObjectURL(new Blob([p.audio], { type: p.type })))
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
      <button class="c-play" aria-label={state === 'idle' ? 'Play this prayer' : 'Stop'} onClick={play}>
        {state === 'idle'
          ? <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
          : <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>}
      </button>
      <span>A prayer <span class="muted">· {state === 'loading' ? 'Opening…' : state === 'playing' ? `${duration(pos)} / ${duration(total)}` : duration(total)}</span></span>
    </div>
  )
}

/** Share verses, a bookmark, a note or a prayer with one of your circles:
 *  one tap to choose the circle (if there's more than one), and Share. */
export function ShareSheet({ request, onClose }: { request: ShareRequest; onClose: () => void }) {
  const { marks } = useApp()
  const [list, setList] = useState<CircleInfo[]>()
  const [pick, setPick] = useState('')
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)
  const [what, setWhat] = useState('')
  // Your notes on exactly these verses (or covering the one verse).
  const v = 'verse' in request ? request.verse : undefined
  const notes = v ? notesCovering(marks, v.book, v.chapter, v.verses[0]).filter(x => v.verses.length === 1 || x.verses.join() === v.verses.join()) : []
  const bookmarked = !!v && v.verses.every(n => marks[markKey(v.book, v.chapter, n)]?.b)
  const [kind, setKind] = useState<'verse' | 'bookmark' | 'note'>(() => 'verse' in request && request.note ? 'note' : bookmarked ? 'bookmark' : 'verse')
  const [noteId, setNoteId] = useState(() => (notes.find(x => 'verse' in request && x.n === request.note) ?? notes[notes.length - 1])?.id ?? '')
  const theNote = 'verse' in request && request.note && !notes.some(x => x.id === noteId) ? request.note : notes.find(x => x.id === noteId)?.n
  useEffect(() => {
    keptCircles().then(cs => { setList(cs); setPick(cs[0]?.id ?? '') })
    if ('prayer' in request) prayers.get(request.prayer).then(p => setWhat(p ? `Your prayer · ${duration(p.ms)}${p.verse ? ` · ${verseLabel(p.verse)}` : ''}` : ''))
    else setWhat(verseLabel(request.verse))
  }, [])
  const circle = list?.find(c => c.id === pick)
  const send = async () => {
    if (!pick) return
    setBusy(true); setMsg('')
    try {
      if ('prayer' in request) await sharePrayer(pick, request.prayer, words.trim())
      else await shareVerse(pick, kind, request.verse, request.version, request.text, kind === 'note' ? theNote : words.trim())
      setDone(true)
      setTimeout(onClose, 900)
    } catch (e) { setMsg(navigator.onLine === false ? 'You’re offline. Share again once you’re connected.' : message(e)) } finally { setBusy(false) }
  }
  const canNote = notes.length > 0 || ('verse' in request && !!request.note)
  return (
    <Sheet title="Share with your circle" onClose={onClose}>
      <div class="c-share">
        <p><strong>{what}</strong></p>
        {'verse' in request && <>
          <div class="seg c-pick" role="radiogroup" aria-label="Share as">
            <button role="radio" aria-checked={kind === 'verse'} class={kind === 'verse' ? 'on' : ''} onClick={() => setKind('verse')}>Verse</button>
            <button role="radio" aria-checked={kind === 'bookmark'} class={kind === 'bookmark' ? 'on' : ''} onClick={() => setKind('bookmark')}>Bookmark</button>
            {canNote && <button role="radio" aria-checked={kind === 'note'} class={kind === 'note' ? 'on' : ''} onClick={() => setKind('note')}>My note</button>}
          </div>
          {kind === 'note' && notes.length > 1 && (
            <ul class="c-notes">{notes.map(x => (
              <li><label><input type="radio" name="c-note" checked={noteId === x.id} onChange={() => setNoteId(x.id)} /> <span>{x.n}</span></label></li>
            ))}</ul>
          )}
          {kind === 'note' && notes.length <= 1 && theNote && <p class="c-note c-note-main">{theNote}</p>}
          <p class="c-quote small">{request.text}</p>
          {kind === 'bookmark' && <p class="muted small">They can bookmark it too, with one tap.</p>}
        </>}
        {list && list.length > 1 && (
          <div class="seg c-pick" role="radiogroup" aria-label="Circle">
            {list.map(c => <button role="radio" aria-checked={pick === c.id} class={pick === c.id ? 'on' : ''} onClick={() => setPick(c.id)}>{c.name}</button>)}
          </div>
        )}
        {kind !== 'note' && <textarea rows={2} maxLength={1000} value={words} placeholder="Add a few words (optional)" onInput={e => setWords((e.target as HTMLTextAreaElement).value)} />}
        {'prayer' in request && <p class="muted small">Everyone in {circle?.name ?? 'the circle'} will be able to hear this prayer.</p>}
        <button class="c-btn primary" disabled={busy || done || !pick || (kind === 'note' && !theNote)} onClick={send}>{done ? 'Shared ✓' : busy ? 'Sharing…' : `Share with ${circle?.name ?? 'circle'}`}</button>
        {msg && <p class="note small">{msg}</p>}
        {list && !list.length && <p class="muted">You’re not in a circle on this device yet. Open Settings → Circles.</p>}
      </div>
    </Sheet>
  )
}
