// Circles: a few people sharing what they read and pray. #/circles lists
// yours, #/circles/<id> shows one, and #/join?… is an invite link. Loaded
// only when one of these opens, or when something is shared.
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  accountKeyCode, amen, CircleInfo, createCircle, Feed, FeedItem, Invite, inviteLink, joinCircle, keptCircles, keptFeed,
  leaveCircle, listCircles, loadFeed, prayerAudio, readInvite, removeShared, sharePrayer, shareVerse,
} from './lib/circles'
import { duration, prayers } from './lib/prayers'
import { verseLabel } from './lib/prayerVerses'
import { loadAccount, SYNC_URL } from './lib/sync'
import { canShare, copyText, share } from './lib/native'
import { go, readPath, Route, ShareRequest, useApp } from './state'
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
  useEffect(() => { document.title = 'Circles · Plain Bible' }, [])
  if (!SYNC_URL) return <div class="circles"><h1>Circles</h1><p class="muted">Circles aren’t available in this copy of the app.</p></div>
  if (!loadAccount()) return (
    <div class="circles">
      <h1>Circles</h1>
      <p>Share the verses you read and the prayers you pray with a few people you choose: family, a friend, a small group.</p>
      <p class="muted">Sign in first. Everything you share is encrypted on your device, so only the people in your circle can read or hear it.</p>
      <button class="c-btn primary" onClick={() => go('settings')}>Go to Settings → Account</button>
    </div>
  )
  if (route.path[0] === 'join') return <Join id={route.params.get('i') ?? ''} secret={route.params.get('k') ?? ''} />
  return route.path[1] ? <CircleView id={route.path[1]} /> : <CircleList />
}

/** The account key typed in, for a device whose passkey can't unlock it. */
function CodeEntry({ busy, onCode, onCancel }: { busy: boolean; onCode: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState('')
  return (
    <div class="c-card">
      <p class="muted">This passkey can’t unlock your circles here. On a device where they open, go to Circles → Show my key, and type it below.</p>
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

  const load = async (code?: string) => {
    setBusy(true); setMsg('')
    try {
      const r = await listCircles(code)
      if (r === 'needCode') setNeedCode('list')
      else { setList(r); setNeedCode('') }
    } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  // What's kept shows at once (and offline); the server fills in the rest.
  // Unlocking can ask for the passkey, so that waits for a tap.
  useEffect(() => { keptCircles().then(k => { setList(k); if (navigator.onLine !== false) load() }) }, [])

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
        ? <CodeEntry busy={busy} onCode={c => needCode === 'create' ? create(c) : load(c)} onCancel={() => setNeedCode('')} />
        : <>
          {list?.length ? (
            <ul class="c-list">
              {list.map(c => (
                <li><a href={`#/circles/${c.id}`}><strong>{c.name}</strong><span class="muted">{c.members === 1 ? 'Just you so far' : `${c.members} people`} ›</span></a></li>
              ))}
            </ul>
          ) : list && !busy && <p>You’re not in a circle yet. Make one, then invite people with a link.</p>}
          {making ? (
            <div class="c-card">
              <label class="c-label">Name of the circle<input value={name} maxLength={60} placeholder="Family, Tuesday group…" onInput={e => setName((e.target as HTMLInputElement).value)} /></label>
              <label class="c-label">Your name in it<input value={me} maxLength={40} placeholder="How the others will see you" onInput={e => setMe((e.target as HTMLInputElement).value)} /></label>
              <div class="c-row">
                <button class="c-btn primary" disabled={busy || !name.trim() || !me.trim()} onClick={() => create()}>{busy ? 'Making…' : 'Make circle'}</button>
                <button class="c-btn" onClick={() => setMaking(false)}>Cancel</button>
              </div>
            </div>
          ) : <button class="c-btn primary" onClick={() => setMaking(true)}>New circle</button>}
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
          <p>You’ve been invited to <strong>{invite.name}</strong> ({invite.members === 1 ? '1 person' : `${invite.members} people`}).</p>
          <p class="muted small">You’ll see the verses and prayers they share, and they’ll see what you choose to share. Nothing is shared without your tap.</p>
          <label class="c-label">Your name in it<input value={me} maxLength={40} placeholder="How the others will see you" onInput={e => setMe((e.target as HTMLInputElement).value)} /></label>
          <button class="c-btn primary" disabled={busy || !me.trim()} onClick={() => join()}>{busy ? 'Joining…' : 'Join'}</button>
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
  useEffect(() => { if (info) document.title = `${info.name} · Plain Bible` }, [info])

  const makeInvite = async () => {
    setBusy(true); setMsg('')
    try { setInvite(await inviteLink(id)) } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  const sendInvite = async () => {
    const text = `Join ${info?.name ?? 'my circle'} in Plain Bible, to share what we read and pray. This link works once, for 7 days.`
    if (canShare) await share({ title: 'Plain Bible circle', text, url: invite })
    else await copyText(invite).then(() => setMsg('Link copied.'), () => {})
  }
  const leave = async () => {
    setBusy(true)
    try { await leaveCircle(id); go('circles', true) } catch (e) { setMsg(message(e)); setBusy(false) }
  }
  const nameOf = (mid: string) => mid === feed?.me ? 'You' : feed?.members.find(m => m.mid === mid)?.name ?? 'Someone who left'
  const fav = settings.favorite || settings.version

  return (
    <div class="circles">
      <a class="c-back" href="#/circles">‹ Circles</a>
      <h1>{info?.name ?? 'Circle'}</h1>
      {feed && <p class="muted small">{feed.members.map(m => m.mid === feed.me ? 'You' : m.name).join(', ')}</p>}
      <div class="c-row">
        {invite
          ? <button class="c-btn primary" onClick={sendInvite}>{canShare ? 'Send invite link' : 'Copy invite link'}</button>
          : <button class="c-btn" disabled={busy} onClick={makeInvite}>{busy ? 'Making link…' : 'Invite someone'}</button>}
      </div>
      {invite && <p class="muted small">The link lets one person in and works for 7 days. Send it only to the person you mean.</p>}
      {msg && <p class="note small">{msg}</p>}
      {feed && !feed.items.length && <p class="muted c-empty">Nothing shared yet. Select verses while reading and tap Circle, or share a prayer from Your prayers.</p>}
      <ol class="c-feed">
        {feed?.items.map(item => <Item circle={id} item={item} mine={item.by === feed.me} me={feed.me} by={nameOf(item.by)} names={item.amens.map(nameOf)} fav={fav} onChange={load} />)}
      </ol>
      <div class="c-foot">
        {leaving
          ? <div class="c-row"><button class="c-btn" onClick={() => setLeaving(false)}>Stay</button><button class="c-btn danger" disabled={busy} onClick={leave}>Leave and remove what I shared</button></div>
          : <button class="link small" onClick={() => setLeaving(true)}>Leave this circle</button>}
      </div>
    </div>
  )
}

function Item({ circle, item, mine, me, by, names, fav, onChange }: {
  circle: string; item: FeedItem; mine: boolean; me: string; by: string; names: string[]; fav: string; onChange: () => void
}) {
  const b = item.body
  const prayed = item.amens.includes(me)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')
  const act = (fn: () => Promise<unknown>) => async () => {
    setBusy(true); setErr('')
    try { await fn(); onChange() } catch (e) { setErr(message(e)) } finally { setBusy(false) }
  }
  const verse = b.verse
  return (
    <li class="c-item">
      <div class="c-item-head"><strong>{by}</strong><span class="muted small">{when(item.at)}</span></div>
      {b.k === 'verse' && <>
        <p class="c-quote">{b.text}</p>
        <button class="link" onClick={() => go(readPath(fav, b.verse.book, b.verse.chapter, b.verse.verses[0]))}>{verseLabel(b.verse)} <span class="muted small">({b.version})</span></button>
      </>}
      {b.k === 'prayer' && <>
        <PrayerPlayer circle={circle} item={item} onError={setErr} />
        {verse && <button class="link" onClick={() => go(readPath(fav, verse.book, verse.chapter, verse.verses[0]))}>Prayed with {verseLabel(verse)}</button>}
      </>}
      {b.note && <p class="c-note">{b.note}</p>}
      <div class="c-item-foot">
        <button class={'c-amen' + (prayed ? ' on' : '')} aria-pressed={prayed} disabled={busy} onClick={act(() => amen(circle, item.id, !prayed))}
          title={names.length ? `Praying with you: ${names.join(', ')}` : 'Praying with you'}>
          🙏 {prayed ? 'Praying' : 'Pray with'}{names.length ? ` · ${names.length}` : ''}
        </button>
        {names.length > 0 && <span class="muted small">{names.join(', ')}</span>}
        <span class="spacer" />
        {mine && (confirm
          ? <><button class="c-btn small" onClick={() => setConfirm(false)}>Keep</button><button class="c-btn small danger" disabled={busy} onClick={act(() => removeShared(circle, item.id))}>Remove for everyone</button></>
          : <button class="link small" onClick={() => setConfirm(true)}>Remove</button>)}
      </div>
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

/** Share verses or a prayer with one of your circles: one tap to choose
 *  the circle (if there's more than one), an optional line, and Share. */
export function ShareSheet({ request, onClose }: { request: ShareRequest; onClose: () => void }) {
  const [list, setList] = useState<CircleInfo[]>()
  const [pick, setPick] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)
  const [what, setWhat] = useState('')
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
      if ('prayer' in request) await sharePrayer(pick, request.prayer, note.trim())
      else await shareVerse(pick, request.verse, request.version, request.text, note.trim())
      setDone(true)
      setTimeout(onClose, 900)
    } catch (e) { setMsg(navigator.onLine === false ? 'You’re offline. Share again once you’re connected.' : message(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Share with your circle" onClose={onClose}>
      <div class="c-share">
        <p><strong>{what}</strong></p>
        {'verse' in request && <p class="c-quote small">{request.text}</p>}
        {list && list.length > 1 && (
          <div class="seg c-pick" role="radiogroup" aria-label="Circle">
            {list.map(c => <button role="radio" aria-checked={pick === c.id} class={pick === c.id ? 'on' : ''} onClick={() => setPick(c.id)}>{c.name}</button>)}
          </div>
        )}
        <textarea rows={2} maxLength={1000} value={note} placeholder="Add a few words (optional)" onInput={e => setNote((e.target as HTMLTextAreaElement).value)} />
        {'prayer' in request && <p class="muted small">Everyone in {circle?.name ?? 'the circle'} will be able to hear this prayer.</p>}
        <button class="c-btn primary" disabled={busy || done || !pick} onClick={send}>{done ? 'Shared ✓' : busy ? 'Sharing…' : `Share with ${circle?.name ?? 'circle'}`}</button>
        {msg && <p class="note small">{msg}</p>}
        {list && !list.length && <p class="muted">You’re not in a circle on this device yet. Open Settings → Circles.</p>}
      </div>
    </Sheet>
  )
}
