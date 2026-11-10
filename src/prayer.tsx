// A quiet moment to pray out loud. One glowing microphone over the page you
// were reading, dimmed just enough that the words are still there. What you
// say is recorded and kept on this device only; nothing is sent anywhere.
import { nowPlaying } from './lib/nowplaying'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { holdUpdate } from './lib/update'
import { AskApproval } from './approve'
import { canRecord, duration, partsOf, prayers, PrayerInfo, recordingType } from './lib/prayers'
import { plain } from './lib/text'
import { lengthMs, playable } from './lib/mp4'
import { Circle, circlesWithAll, loadShared, SHARED_EVENT, SharedIn } from './lib/prayerShared'
import { go, inCircles, openSettings, parseHash, pickVerses, PrayAt, readPath, shareWithCircle, useApp, verseToPrayOver } from './state'
import { pauseListening, readingAt } from './listen'
import { BackIcon, CircleIcon, CloseIcon } from './icons'
import type { Journal } from './lib/prayerJournal'
import { byMonth, finds, longDuration, TOPICS, topicsOf } from './lib/prayerJournal'
import { holdsVerse, MAX_TIED, PrayerVerse, verseLabel, versesOf, withVerse } from './lib/prayerVerses'
import { Comfort, pickComfort } from './lib/comfort'
import type { Bible } from './lib/data'
import { deletedHere, prayerKeyCode, prayerSyncOn, syncPrayers, turnOffPrayerSync, turnOnPrayerSync } from './lib/prayerSync'
import { loadAccount, SYNC_URL } from './lib/sync'
import { slideAway, usePullDown } from './settings'
import { DeviceLink } from './move'
import { addDays, dayBefore, dayOf, loadDays, markDay, PRAY, streak } from './lib/streaks'
import './prayer.css'
import { locale, N_, t, tj, tn } from './i18n'

// paused: the phone locked, or the microphone stopped, mid-prayer. What was said is kept, and the next
// tap carries on in the same prayer.
type Phase = 'idle' | 'asking' | 'recording' | 'paused' | 'heard'
type Cut = 'lock' | 'mic'

/** The words of `v` in `b`, or undefined if that Bible lacks any of them. */
function wordsOf(b: Bible | undefined, v: PrayerVerse) {
  const raw = v.verses.map(n => b?.books[v.book]?.[v.chapter - 1]?.[n - 1])
  return raw.every(Boolean) ? raw.map(r => plain(r!)).join(' ') : undefined
}

export function Prayer({ at, onClose }: { at?: PrayAt; onClose: () => void }) {
  const { data, settings } = useApp()
  const version = settings.version
  const [phase, setPhase] = useState<Phase>('idle')
  // Why the last pause happened.
  const [pausedBy, setPausedBy] = useState<Cut>('lock')
  // Praying, Your prayers, or Circles (opened from its own button beside 🙏).
  const [view, setView] = useState<'pray' | 'list' | 'circles'>(at ? 'circles' : 'pray')
  useEffect(() => { if (at) setView('circles') }, [at])
  const [note, setNote] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [list, setList] = useState<PrayerInfo[]>()
  const [bible, setBible] = useState<Bible>()
  // Said back once a prayer is kept: a verse picked at random, in the Bible you read.
  const [comfort, setComfort] = useState<Comfort>(pickComfort)
  // The verses this prayer is prayed using, from anywhere in the Bible.
  // Verses you just selected are offered; Pray on the selection bar (or
  // Done after Add a verse) ties them straight away.
  // The verses this prayer is about: those chosen for it; else, while reading
  // aloud, the verse being read, picked at once; else a verse just selected on
  // the chapter still open is offered.
  const [offer] = useState(() => {
    const o = verseToPrayOver()
    if (o?.sure) return o
    const at = readingAt()
    if (at) return { verses: [{ book: at.book, chapter: at.chapter, verses: [at.verse] }], sure: true }
    const r = parseHash().path
    if (o && r[0] === 'read' && !o.verses.some(v => v.book === r[2] && v.chapter === +r[3])) return undefined
    return o
  })
  // Reading aloud waits, paused on its verse, while you pray.
  useEffect(() => { if (readingAt()) pauseListening() }, [])
  const [tied, setTiedNow] = useState<PrayerVerse[]>(offer?.sure ? offer.verses : [])
  const tiedRef = useRef(tied)
  const setTied = (v: PrayerVerse[]) => { tiedRef.current = v; setTiedNow(v) }
  // The prayer just kept, and the verses it's tied to.
  const [kept, setKept] = useState<{ id: string; verses: PrayerVerse[] }>()
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; started: number; timer: number; lock?: WakeLockSentinel; interrupted?: Cut }>()
  // The prayer a paused recording carries on, and how long it already is.
  const resume = useRef<{ id: string; ms: number }>()
  const alive = useRef(true)
  // The dim starts under the top bar: the clock strip above it keeps the
  // color the app opened with (an installed iPhone app can't repaint it),
  // so dimming the bar too left a bright strip over a gray one.
  const [cut] = useState(() => Math.max(0, Math.round(document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0)))
  // With the keyboard up (naming a new circle, say), iPhone slides the whole
  // page up under it, but this screen stays put: the dim stopped halfway down
  // and the Bible showed, undimmed, between it and the keyboard. So while the
  // keyboard is up the screen covers just what's left of the view, and the
  // card sits right above the keyboard.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const vv = window.visualViewport, el = root.current
    if (!vv || !el) return
    const fit = () => {
      const up = vv.height < innerHeight - 100
      el.style.top = up ? vv.offsetTop + 'px' : ''
      el.style.height = up ? vv.height + 'px' : ''
      el.style.bottom = up ? 'auto' : ''
      // The top bar slid up with the page.
      el.style.setProperty('--cut', Math.max(0, cut - (up ? vv.offsetTop : 0)) + 'px')
    }
    const resized = () => {
      fit()
      // Keep the field you're typing in in sight once the card has shrunk.
      // (The card, not the page: that would move the Bible underneath.)
      const f = document.activeElement, box = f instanceof HTMLElement && el.contains(f) ? f.closest('.pray-list') : null
      if (!f || !box) return
      const r = f.getBoundingClientRect(), b = box.getBoundingClientRect()
      if (r.bottom > b.bottom - 12) box.scrollTop += r.bottom - b.bottom + 12
      else if (r.top < b.top + 12) box.scrollTop -= b.top + 12 - r.top
    }
    vv.addEventListener('resize', resized)
    vv.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', resized); vv.removeEventListener('scroll', fit) }
  }, [])

  // Every prayer kept (here, or synced from another device) is a day prayed.
  const refresh = () => prayers.list().then(l => {
    addDays(Object.fromEntries(l.map(p => [dayOf(p.at), PRAY])))
    if (alive.current) setList(l)
  }, () => setList([]))
  // With sync on, bring in what was prayed on other devices, and send what's new here.
  const sync = () => syncPrayers().then(changed => { if (changed) refresh() }, () => {})
  useEffect(() => {
    refresh(); sync()
    data.bible(version).then(b => { if (alive.current) setBible(b) }).catch(() => {})
    document.documentElement.classList.add('praying')
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // Phones cut the microphone off when the app goes to the background or
    // the screen locks: keep what was said so far, and offer to carry on.
    const hidden = () => { if (document.visibilityState === 'hidden') stop('lock') }
    addEventListener('keydown', esc)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      alive.current = false
      stop()
      document.documentElement.classList.remove('praying')
      removeEventListener('keydown', esc)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])

  const start = async () => {
    if (!canRecord()) { setNote(t('This browser can’t record audio. Try Safari or Chrome.')); return }
    setNote(''); setPhase('asking')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      setPhase('idle')
      setNote((e as DOMException)?.name === 'NotAllowedError'
        ? t('The microphone is blocked. Allow it for this app in your browser or phone settings, then tap again.')
        : t('No microphone could be found.'))
      return
    }
    if (!alive.current) { stream.getTracks().forEach(track => track.stop()); return }
    const type = recordingType()
    let recorder: MediaRecorder
    // A voice needs far less than music: smaller files to keep, and to sync.
    try { recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64_000 }) } catch {
      stream.getTracks().forEach(track => track.stop())
      setPhase('idle'); setNote(t('This browser can’t record audio.'))
      return
    }
    const chunks: Blob[] = []
    const started = Date.now()
    const before = resume.current
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop())
      const wall = Date.now() - started
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/mp4' })
      let interrupted = this_.interrupted
      if (!blob.size || wall < 800) { if (alive.current) setPhase(before ? (interrupted ? 'paused' : 'heard') : 'idle'); return }
      try {
        const audio = await blob.arrayBuffer()
        // A microphone that went quiet without a word (Bluetooth in a car,
        // say) leaves less sound than time went by. Count only what was
        // heard, and pause so the prayer can carry on.
        const heard = lengthMs(audio, blob.type)
        // A little slack, as recorders round their lengths a little.
        const short = heard !== undefined && heard < wall - Math.max(2000, wall * 0.03)
        const ms = short ? heard : wall
        if (short) interrupted = 'mic'
        if (ms < 800) {
          if (alive.current) { setPausedBy('mic'); setElapsed(before?.ms ?? 0); setPhase(before ? 'paused' : 'idle'); if (!before) setNote(t('The microphone stopped, so nothing was recorded. This can happen with Bluetooth, like in a car. Tap to try again.')) }
          return
        }
        const part = { ms, type: blob.type, audio }
        let id = before?.id
        const tie = tiedRef.current
        if (id) await prayers.append(id, part).catch(() => { id = undefined })
        if (id) await prayers.tie(id, tie).catch(() => {})
        if (!id) await prayers.put({ id: id = started.toString(36) + Math.random().toString(36).slice(2, 6), at: started, ...part, ...(tie.length ? { verse: tie[0], verses: tie, vrev: 1, vdirty: true } : {}) })
        markDay(PRAY, dayOf(started))
        navigator.storage?.persist?.().catch(() => {})
        resume.current = interrupted ? { id, ms: (before?.ms ?? 0) + ms } : undefined
        if (alive.current) {
          if (interrupted) { setPausedBy(interrupted); setElapsed((before?.ms ?? 0) + ms); setPhase('paused') }
          else await heardNow(id)
          refresh()
        }
        sync()
      } catch {
        if (alive.current) { setPhase('idle'); setNote(t('Your prayer couldn’t be kept: this device may be out of space.')) }
      }
    }
    // Hand over the audio every second, so an interruption loses little.
    recorder.start(1000)
    const this_: NonNullable<typeof rec.current> = { recorder, stream, started, timer: window.setInterval(() => setElapsed((before?.ms ?? 0) + Date.now() - started), 250) }
    rec.current = this_
    // The microphone going silent under us (a call, or the phone switching
    // to a car's Bluetooth) would leave the timer running over silence.
    const track = stream.getAudioTracks()[0]
    if (track) {
      let quiet = 0
      track.onended = () => { if (rec.current === this_) stop('mic') }
      track.onmute = () => { clearTimeout(quiet); quiet = window.setTimeout(() => { if (rec.current === this_) stop('mic') }, 1500) }
      track.onunmute = () => clearTimeout(quiet)
    }
    // Keep the screen awake while praying, so the phone doesn't lock itself
    // and cut the microphone off.
    navigator.wakeLock?.request('screen').then(l => { if (rec.current === this_) this_.lock = l; else l.release() }).catch(() => {})
    setElapsed(before?.ms ?? 0); setPhase('recording')
  }

  function stop(interrupted?: Cut) {
    const r = rec.current
    if (!r) return
    r.interrupted = interrupted
    rec.current = undefined
    clearInterval(r.timer)
    r.lock?.release().catch(() => {})
    if (r.recorder.state !== 'inactive') r.recorder.stop()
    else r.stream.getTracks().forEach(track => track.stop())
  }

  // Amen: a new verse to take away, kept with the prayer as one of its
  // verses (by reference, so a circle reads it in their own Bible), and the
  // prayer's own verses, if it has any.
  function heardNow(id?: string) {
    const c = pickComfort()
    setComfort(c)
    setTied([])
    setPhase('heard')
    if (!id) return Promise.resolve()
    const v = { book: c.book, chapter: c.chapter, verses: c.verses }
    return prayers.get(id).then(async p => {
      if (!p) return
      const verses = withVerse(versesOf(p), v)
      if (verses !== versesOf(p)) await prayers.tie(id, verses).catch(() => {})
      const now = await prayers.get(id).catch(() => p)
      if (alive.current && now) setKept({ id, verses: versesOf(now) })
    }, () => {})
  }
  // Amen while paused: verses changed meanwhile are kept with the prayer.
  const amen = () => {
    const id = resume.current?.id
    resume.current = undefined
    if (!id) return heardNow()
    prayers.tie(id, tiedRef.current).catch(() => {}).then(() => heardNow(id)).then(() => { refresh(); sync() })
  }
  const read = (v: PrayerVerse) => { onClose(); go(readPath(version, v.book, v.chapter, v.verses[0])) }
  // Add a verse: the prayer steps aside, and the verses you tap on the page,
  // in any chapter or book, are added to it, until Done.
  const pickFor = (verses: PrayerVerse[], prayer?: string) => { pickVerses({ prayer, verses, from: verses }); onClose() }
  const busy = phase === 'recording' || phase === 'paused' || phase === 'asking'
  // Never update the app by itself in the middle of a prayer.
  useEffect(() => { holdUpdate('prayer', busy); return () => holdUpdate('prayer', false) }, [busy])
  const toggle = () => phase === 'recording' ? stop() : phase !== 'asking' && start()
  const count = list?.length ?? 0
  const others = (kept?.verses ?? []).filter(v => !(v.book === comfort.book && v.chapter === comfort.chapter && v.verses.join() === comfort.verses.join()))
  const comfortKept = !!kept && holdsVerse(kept.verses, comfort)
  const keptLine = (refs: ComponentChildren) => !others.length ? t('Kept with this prayer')
    : comfortKept ? tj('Kept with this prayer, along with {verses}', { verses: refs })
    : tj('Prayed using {verse}', { verse: refs })

  return (
    <div class="pray" role="dialog" aria-modal="true" ref={root} aria-label={t('Prayer')} style={{ '--cut': `${cut}px` }}>
      {/* The list has its own Done, so only one close is ever on screen. */}
      {view === 'pray' && <button class="pray-close" aria-label={t('Close')} onClick={onClose}><CloseIcon size={26} /></button>}
      {view === 'pray' && phase !== 'heard' && (tied.length
        ? <div class="pray-over">
            <p class="pray-over-head">{t('Praying using')}</p>
            <ul>
              {tied.map(v => <li>
                <strong>{verseLabel(v)}</strong>
                <button class="pray-over-x" aria-label={t('Don’t tie this prayer to {verse}', { verse: verseLabel(v) })} onClick={() => setTied(tied.filter(x => x !== v))}>✕</button>
              </li>)}
            </ul>
            {!busy && tied.length < MAX_TIED && <button class="pray-over-add" onClick={() => pickFor(tied)}>+ {t('Add a verse')}</button>}
          </div>
        : !busy && (offer
          ? <button class="pray-over offer" onClick={() => setTied(offer.verses)}>
              <span>+ {tj('Pray using {verse}', { verse: <strong>{offer.verses.map(verseLabel).join(', ')}</strong> })}</span>
            </button>
          : <button class="pray-over offer" onClick={() => pickFor([])}><span>+ {t('Add a verse')}</span></button>))}
      {view === 'pray' ? (
        <div class="pray-center">
          <button class={'pray-mic' + (phase === 'recording' ? ' on' : '')} onClick={toggle}
            aria-label={phase === 'recording' ? t('Amen: stop and keep this prayer') : phase === 'paused' ? t('Keep praying') : t('Start praying out loud')}>
            <svg viewBox="0 0 24 24" width="52" height="52" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12.5" rx="3.5" fill="currentColor" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" /></svg>
          </button>
          <div class="pray-words" aria-live="polite">
            {note ? <p>{note}</p>
              : phase === 'recording' ? <><p class="pray-time">{duration(elapsed)}</p><p>{t('Tap when you’re done.')}</p></>
              : phase === 'asking' ? <p>…</p>
              : phase === 'paused' ? <>
                  <p class="pray-time">{duration(elapsed)}</p>
                  <p>{pausedBy === 'mic'
                    ? t('The microphone stopped, so your prayer paused. This can happen with Bluetooth, like in a car. What it heard is kept.')
                    : t('The phone locked, so your prayer paused. Everything you said is kept.')}</p>
                  <p>{t('Tap the light to keep praying, or')}</p>
                  <button class="pray-pill pray-amen-btn" onClick={amen}>{t('Amen')}</button>
                </>
              : phase === 'heard' ? <>
                  <p class="pray-amen">{t('Amen. He heard you.')}</p>
                  {settings.streaks && <PrayStreak />}
                  <button class="pray-verse" onClick={() => read(comfort)}>
                    “{wordsOf(bible, comfort) ?? comfort.kjv}” <span class="pray-ref">{verseLabel(comfort)}</span>
                  </button>
                  {/* One line says where the verses went: the verse above is
                      kept with the prayer, and so are any picked before it. */}
                  {(comfortKept || others.length > 0) && (others.length === 1
                    ? <button class="pray-kept" onClick={() => read(others[0])}>✓ {keptLine(<strong>{verseLabel(others[0])}</strong>)} ›</button>
                    : <p class="pray-kept">✓ {keptLine(others.map((v, i) => <>{i ? ', ' : ''}<button class="pray-kept-ref" onClick={() => read(v)}>{verseLabel(v)}</button></>))}</p>)}
                </>
              : <p>{t('Tap and speak to God. Only you will hear this again.')}</p>}
          </div>
        </div>
      ) : view === 'list' ? <PrayerList list={list} onChange={refresh} onClose={onClose} onRead={read} onPick={pickFor} />
        : <CirclesCard at={at} onClose={onClose} />}
      <div class="pray-foot">
        {view === 'list'
          ? <button class="pray-pill" onClick={() => setView('pray')}>{t('Pray')}</button>
          : view === 'pray' && phase !== 'recording' && phase !== 'paused' &&
            <button class="pray-pill" onClick={() => setView('list')}>{t('Your prayers')}{count ? ` · ${count}` : ''}</button>}
        {view !== 'circles' && <p class="pray-private">{prayerSyncOn() ? t('Encrypted on this device, then synced.') : t('Kept on this device only.')}</p>}
      </div>
    </div>
  )
}

// Circles' code and the list kept on this phone, loaded before the card first
// shows (see app.tsx), so it opens filled in instead of growing up the screen.
let circlesMod: typeof import('./circles') | undefined
export const warmCircles = (circle?: string) => import('./circles').then(m => { circlesMod = m; return Promise.all([m.warmList(), circle && m.warmFeed(circle)]) })

/** Circles, opened from its own button: the same card as Your prayers. Done (or a pull down)
 *  closes it from anywhere, back to the word; inside one circle, ‹ back goes to the list. */
function CirclesCard({ at, onClose }: { at?: PrayAt; onClose: () => void }) {
  const [mod, setMod] = useState(() => circlesMod)
  useEffect(() => { if (!mod) warmCircles().then(() => setMod(() => circlesMod), () => {}) }, [])
  const [circle, setShown] = useState(at?.circle)
  // A circle opens once what it holds is ready (it's kept on this phone, so
  // that's a moment), not as a bare title that then fills in.
  const setCircle = (c?: { id: string; name: string }) => {
    if (!c || !circlesMod) return setShown(c)
    Promise.race([circlesMod.warmFeed(c.id).catch(() => {}), new Promise(r => setTimeout(r, 300))]).then(() => setShown(c))
  }
  useEffect(() => setCircle(at?.circle), [at])
  const box = useRef<HTMLDivElement>(null)
  usePullDown(box, () => box.current?.scrollTop ?? 0, onClose)
  useEffect(() => { box.current?.scrollTo(0, 0) }, [circle?.id])
  const done = () => slideAway(box.current, onClose)
  return (
    // A link inside (a verse, mostly) goes to the word, so prayer steps aside.
    <div class="pray-list pray-circles" ref={box} onClick={e => { if ((e.target as Element).closest?.('a[href^="#"]')) onClose() }}>
      <div class="pray-head">
        <button type="button" class="settings-grabber" aria-label={t('Close')} onClick={done} />
        <div class="pray-title">
          {circle
            ? <button class="settings-back" onClick={() => setCircle(undefined)}><BackIcon class="back-ico" /> <span class="back-name">{circle.name}</span></button>
            : <h2>{t('Circles')}</h2>}
          <button class="done-btn" onClick={done}>{t('Done')}</button>
        </div>
      </div>
      {mod ? <mod.CirclesPanel circle={circle?.id} onOpen={setCircle} onAway={onClose} /> : <p class="muted">{t('Opening…')}</p>}
    </div>
  )
}

function PrayerList({ list, onChange, onClose, onRead, onPick }: {
  list?: PrayerInfo[]; onChange: () => void; onClose: () => void; onRead: (v: PrayerVerse) => void; onPick: (verses: PrayerVerse[], prayer: string) => void
}) {
  const [playing, setPlaying] = useState<string>()
  // Play all: the prayers shown, one after the other.
  const [inTurn, setInTurn] = useState(false)
  const [pos, setPos] = useState(0)
  const [confirm, setConfirm] = useState<string>()
  const audio = useRef<{ el: HTMLAudioElement; urls: string[] }>()
  // Counts every start and stop, so a recording still being read when
  // something else was tapped doesn't start after all.
  const turn = useRef(0)
  const release = () => {
    turn.current++
    const a = audio.current
    if (a) { a.el.pause(); a.urls.forEach(u => URL.revokeObjectURL(u)); audio.current = undefined }
    setPlaying(undefined); setPos(0); setInTurn(false)
  }
  useEffect(() => release, [])
  // Where each prayer was shared already: a circle that has it isn't offered
  // again, and once every circle has it, the circle button goes.
  const [where, setWhere] = useState<{ circles: Circle[]; shared: SharedIn }>()
  useEffect(() => {
    if (!inCircles()) return
    const load = () => { loadShared().then(setWhere).catch(() => {}) }
    load()
    addEventListener(SHARED_EVENT, load)
    return () => removeEventListener(SHARED_EVENT, load)
  }, [])
  const sharedWith = (ps: PrayerInfo[]) => where ? where.circles.filter(c => circlesWithAll(where.shared, ps.map(p => p.at)).has(c.id)) : []
  const leftToShare = (ps: PrayerInfo[]) => inCircles() && (!where?.circles.length || sharedWith(ps).length < where.circles.length)

  // Plays `id`, then `rest` in turn, on the one player (an iPhone only lets
  // the player a tap started carry on by itself).
  const start = async (id: string, rest: string[], el: HTMLAudioElement) => {
    const mine = turn.current
    const full = await prayers.get(id)
    if (mine !== turn.current) return
    const next = () => {
      audio.current?.urls.forEach(u => URL.revokeObjectURL(u))
      if (rest.length) start(rest[0], rest.slice(1), el); else release()
    }
    if (!full) { next(); return }
    // A prayer picked up again after the phone locked plays its parts in turn.
    const parts = partsOf(full)
    const urls = parts.map(x => URL.createObjectURL(new Blob([playable(x.audio, x.type)], { type: x.type })))
    let i = 0, offset = 0
    el.ontimeupdate = () => setPos(offset + el.currentTime * 1000)
    el.onended = () => {
      if (++i >= urls.length) { next(); return }
      offset += parts[i - 1].ms
      el.src = urls[i]; el.play().catch(release)
    }
    audio.current = { el, urls }
    setPlaying(id); setPos(0)
    nowPlaying(t('Prayer'))
    if (rest.length || inTurnRef.current) document.getElementById(`pray-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    el.src = urls[0]
    el.play().catch(release)
  }
  const inTurnRef = useRef(false)
  inTurnRef.current = inTurn
  const play = (p: PrayerInfo) => {
    const was = playing === p.id && !inTurn
    release()
    if (!was) start(p.id, [], new Audio())
  }
  const playAll = (ps: PrayerInfo[]) => {
    const was = inTurn
    release()
    if (was || !ps.length) return
    setInTurn(true)
    start(ps[0].id, ps.slice(1).map(p => p.id), new Audio())
  }
  // Send it to someone, or keep your own copy: the share sheet on phones
  // (Messages, Files, Voice Memos…), a download elsewhere. Each part is its own file.
  const ready = useRef<{ id: string; files: File[] }>()
  const [again, setAgain] = useState<string>()
  const save = async (p: PrayerInfo) => {
    let files = ready.current?.id === p.id ? ready.current.files : undefined
    if (!files) {
      const full = await prayers.get(p.id)
      if (!full) return
      const parts = partsOf(full), name = fileName(full.at)
      files = parts.map((x, i) => new File([playable(x.audio, x.type)], `${name}${parts.length > 1 ? ` (${t('{i} of {n}', { i: i + 1, n: parts.length })})` : ''}.${extension(x.type)}`, { type: x.type }))
    }
    if (navigator.canShare?.({ files })) {
      try { await navigator.share({ files }); ready.current = undefined; setAgain(undefined) } catch (e) {
        // Safari wants the share right after the tap; if reading the
        // recording took too long, the next tap shares at once.
        if ((e as Error).name === 'NotAllowedError') { ready.current = { id: p.id, files }; setAgain(p.id) }
      }
      return
    }
    for (const f of files) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(f); a.download = f.name; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    }
  }
  const remove = async (id: string) => {
    if (playing === id) release()
    setConfirm(undefined)
    await prayers.delete(id).catch(() => {})
    await deletedHere(id).catch(() => {})
    onChange()
    syncPrayers().catch(() => {})
  }

  // One way out: Done, or pull the card down, like Settings.
  const box = useRef<HTMLDivElement>(null)
  usePullDown(box, () => box.current?.scrollTop ?? 0, onClose)
  const done = () => slideAway(box.current, onClose)
  const when = (at: number) => new Date(at).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const time = (at: number) => new Date(at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  const date = (at: number) => new Date(at).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric', ...(new Date(at).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })

  // Stars show at once; the list itself catches up when it's read again.
  const [starred, setStarred] = useState<Record<string, boolean>>({})
  const isFav = (p: PrayerInfo) => starred[p.id] ?? !!p.fav
  const star = async (p: PrayerInfo) => {
    const fav = !isFav(p)
    setStarred(s => ({ ...s, [p.id]: fav }))
    await prayers.note(p.id, { fav }).catch(() => {})
    onChange()
    syncPrayers().catch(() => {})
  }
  // Recent: this month by day, earlier months folded. Favorites, or anything
  // typed in the find box: one plain list, each prayer with its date.
  // Topics: each topic in use as one row, and the answered prayers; a tap opens it.
  const [view, setView] = useState<'all' | 'fav' | 'topics'>('all')
  const [topic, setTopic] = useState<string>()
  const [find, setFind] = useState('')
  const [open, setOpen] = useState<string>()
  const [unfolded, setUnfolded] = useState<string[]>([])
  // Days opened or folded by hand; the rest follow the rule (the latest open).
  const [dayOpen, setDayOpen] = useState<Record<string, boolean>>({})
  // Naming a prayer, or choosing its topic, inside its open row.
  const [edit, setEdit] = useState<{ id: string; what: 'name' | 'topic'; text: string }>()
  const all = list ?? [], favs = all.filter(isFav)
  const ANSWERED = '\u2713'
  const inTopic = (name: string) => all.filter(p => name === ANSWERED ? p.answered : p.topic === name)
  const shelves = [ANSWERED, ...topicsOf(all)].filter(name => inTopic(name).length)
  const topicName = (name: string) => name === ANSWERED ? `✓ ${t('Answered')}` : TOPICS.includes(name) ? t(name) : name
  // A topic emptied while it was open (its last prayer moved or deleted) closes.
  const within = view === 'topics' && topic && inTopic(topic).length ? topic : undefined
  const typed = find.trim()
  const flat = view !== 'all' || !!typed
  const shown = (view === 'fav' ? favs : within ? inTopic(within) : all).filter(p => !typed || finds(typed, [
    ...versesOf(p).map(verseLabel), p.name ?? '', p.topic ? topicName(p.topic) : '',
    new Date(p.at).toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
  ]))
  const note = async (p: PrayerInfo, change: Journal) => {
    setEdit(undefined)
    await prayers.note(p.id, change).catch(() => {})
    onChange()
    syncPrayers().catch(() => {})
  }
  const go = (v: 'all' | 'fav' | 'topics') => { setView(v); setTopic(undefined); setOpen(undefined); setEdit(undefined) }
  const { days, months } = flat ? { days: [], months: [] } : byMonth(shown)
  const total = (ps: PrayerInfo[]) => longDuration(ps.reduce((n, p) => n + p.ms, 0))
  const row = (p: PrayerInfo, dated = flat) => (
    <li id={`pray-${p.id}`} class={'pray-row' + (playing === p.id ? ' on' : '') + (open === p.id ? ' open' : '')}>
      <button class="pray-play" aria-label={playing === p.id ? t('Stop') : t('Play prayer from {when}', { when: when(p.at) })} onClick={() => play(p)}>
        {playing === p.id ? <StopIcon /> : <PlayIcon />}
      </button>
      <span class="pray-when">{p.name && <strong class="pray-name">{p.name}</strong>}
        {dated ? date(p.at) : time(p.at)}<span class="muted"> · {playing === p.id ? `${duration(pos)} / ` : ''}{duration(p.ms)}</span>
        {versesOf(p).map(v => <button class="link pray-list-verse" onClick={() => onRead(v)}>{verseLabel(v)}</button>)}
        {(p.topic || p.answered) && <span class="pray-tags">
          {p.topic && <span class="pray-tag">{topicName(p.topic)}</span>}
          {p.answered && <span class="pray-tag answered">✓ {t('Answered')}</span>}
        </span>}
        {sharedWith([p]).length > 0 && <span class="pray-shared muted">✓ {t('Shared with {circle}', { circle: sharedWith([p]).map(c => c.name).join(', ') })}</span>}</span>
      <button class={'pray-icon pray-star' + (isFav(p) ? ' on' : '')} aria-pressed={isFav(p)} aria-label={isFav(p) ? t('Remove from favorites') : t('Add to favorites')} onClick={() => star(p)}>
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill={isFav(p) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
      </button>
      {/* Everything else you can do with a prayer, one tap away, each with its name. */}
      {open === p.id
        ? <button class="close-btn pray-shut" aria-expanded="true" aria-label={t('Close')} onClick={() => { setConfirm(undefined); setEdit(undefined); setOpen(undefined) }}><CloseIcon size={22} /></button>
        : <button class="pray-icon pray-more" aria-expanded="false" aria-label={t('More')} onClick={() => { setConfirm(undefined); setEdit(undefined); setOpen(p.id) }}>
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="19" cy="12" r="2" fill="currentColor" /></svg>
        </button>}
      {open === p.id && edit?.id === p.id && edit.what === 'name' && <form class="pray-edit" onSubmit={e => { e.preventDefault(); note(p, { name: edit.text }) }}>
        <input class="saved-find" value={edit.text} maxLength={80} placeholder={t('Name of this prayer')} aria-label={t('Name of this prayer')} enterkeyhint="done"
          ref={el => { if (el && !el.dataset.on) { el.dataset.on = '1'; el.focus() } }} onInput={e => setEdit({ ...edit, text: (e.target as HTMLInputElement).value })} />
        <div class="pray-confirm">
          <button type="button" class="pray-btn" onClick={() => setEdit(undefined)}>{t('Cancel')}</button>
          <button class="pray-btn primary">{t('Save')}</button>
        </div>
      </form>}
      {/* One topic a prayer: tap one to choose it, tap it again to take it off, or type your own. */}
      {open === p.id && edit?.id === p.id && edit.what === 'topic' && <form class="pray-edit" onSubmit={e => { e.preventDefault(); if (edit.text.trim()) note(p, { topic: edit.text }) }}>
        <div class="pray-topics">
          {topicsOf(all).map(name => <button type="button" class={'pray-topic' + (p.topic === name ? ' on' : '')} aria-pressed={p.topic === name} onClick={() => note(p, { topic: p.topic === name ? '' : name })}>{p.topic === name ? '✓ ' : ''}{topicName(name)}</button>)}
        </div>
        <div class="pray-new-topic">
          <input class="saved-find" value={edit.text} maxLength={40} placeholder={t('New topic')} aria-label={t('New topic')} enterkeyhint="done" onInput={e => setEdit({ ...edit, text: (e.target as HTMLInputElement).value })} />
          <button class="pray-btn primary" disabled={!edit.text.trim()}>{t('Add')}</button>
        </div>
        <button type="button" class="pray-btn" onClick={() => setEdit(undefined)}>{t('Cancel')}</button>
      </form>}
      {open === p.id && confirm !== p.id && edit?.id !== p.id && <div class="pray-acts">
        <button class="pray-act" onClick={() => setEdit({ id: p.id, what: 'name', text: p.name ?? '' })}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5zM14.5 6l3 3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span>{p.name ? t('Rename') : t('Name it')}</span>
        </button>
        <button class="pray-act" onClick={() => setEdit({ id: p.id, what: 'topic', text: '' })}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.5h7A1.5 1.5 0 0 1 20 9v8.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" /></svg>
          <span>{p.topic ? t('Topic: {topic}', { topic: topicName(p.topic) }) : t('Topic')}</span>
        </button>
        <button class={'pray-act' + (p.answered ? ' answered' : '')} aria-pressed={!!p.answered} onClick={() => note(p, { answered: p.answered ? 0 : Date.now() })}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span>{p.answered ? t('Answered') : t('Mark answered')}</span>
        </button>
        {/* Thought of a verse later, or tapped the wrong one? Tap verses on the page to add or take them off. */}
        <button class="pray-act" onClick={() => { release(); onPick(versesOf(p), p.id) }}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
          <span>{versesOf(p).length ? t('Change verses') : t('Add a verse')}</span>
        </button>
        <button class="pray-act" aria-label={t('Share or save this prayer')} onClick={() => save(p)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span>{again === p.id ? t('Share') : t('Share or save')}</span>
        </button>
        {leftToShare([p]) && <button class="pray-act" aria-label={t('Share this prayer with your circle')} onClick={() => shareWithCircle({ prayer: p.id })}>
          <CircleIcon size={22} /> <span>{t('Share with your circle')}</span>
        </button>}
        {/* A bin, not a cross: a cross reads as close. */}
        <button class="pray-act pray-bin" aria-label={t('Delete this prayer')} onClick={() => setConfirm(p.id)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span>{t('Delete')}</span>
        </button>
      </div>}
      {confirm === p.id && <div class="pray-confirm">
        {/* Delete on the far side from the Delete just tapped, and Keep the bold one: a prayer is hard to lose by accident. */}
        <button class="pray-btn danger-quiet" onClick={() => remove(p.id)}>{prayerSyncOn() ? t('Delete everywhere') : t('Delete')}</button>
        <button class="pray-btn primary" onClick={() => setConfirm(undefined)}>{t('Keep')}</button>
      </div>}
    </li>
  )
  return (
    <div class="pray-list pray-journal" ref={box}>
      <div class="pray-head">
        <button type="button" class="settings-grabber" aria-label={t('Close')} onClick={done} />
        <div class="pray-title">
          <h2>{t('Your prayers')}</h2>
          <button class="done-btn" onClick={done}>{t('Done')}</button>
        </div>
      </div>
      {/* Once there are a few: your favorites by themselves, and a box to find one. */}
      {(all.length >= 4 || favs.length > 0 || shelves.length > 0) && <div class="pray-tools">
        {within ? <button class="pray-back" onClick={() => { setTopic(undefined); setOpen(undefined); setEdit(undefined); setFind('') }} aria-label={t('Back')}>
          <BackIcon size={22} /> <strong class={within === ANSWERED ? 'answered' : ''}>{topicName(within)}</strong><span class="muted"> · {tn(inTopic(within).length, '{n} prayer', '{n} prayers')}</span>
        </button> : <div class="seg" role="radiogroup" aria-label={t('Your prayers')}>
          <button role="radio" aria-checked={view === 'all'} class={view === 'all' ? 'on' : ''} onClick={() => go('all')}>{t('Recent')}</button>
          <button role="radio" aria-checked={view === 'fav'} class={view === 'fav' ? 'on' : ''} onClick={() => go('fav')}>★ {t('Favorites')}</button>
          <button role="radio" aria-checked={view === 'topics'} class={view === 'topics' ? 'on' : ''} onClick={() => go('topics')}>{t('Topics')}</button>
        </div>}
        {all.length >= 4 && (view !== 'topics' || within) && <input type="search" class="saved-find" placeholder={t('Find by name, verse or date')} value={find} onInput={e => { setFind((e.target as HTMLInputElement).value); setOpen(undefined); setEdit(undefined) }} />}
      </div>}
      {view === 'topics' && !within ? (shelves.length ? <ol>
        {shelves.map(name => <li class="pray-month"><button onClick={() => { setTopic(name); setFind('') }}>
          <strong class={name === ANSWERED ? 'answered' : ''}>{topicName(name)}</strong>
          <span class="muted">{tn(inTopic(name).length, '{n} prayer', '{n} prayers')} · {total(inTopic(name))}</span>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button></li>)}
      </ol> : <p class="muted">{t('No topics yet. Tap the three dots on a prayer, then Topic, to sort it.')}</p>) : null}
      {view === 'topics' && !within ? null : !all.length ? <p class="muted">{t('No prayers yet.')}</p>
        : !shown.length ? <p class="muted">{typed ? t('No prayer has “{words}” in it.', { words: typed }) : t('No favorites yet. Tap the star on a prayer to keep it here.')}</p> : (
        <ol>
          {/* Stay in them: the whole list, one prayer after the other. */}
          {flat && shown.length > 1 && <li class="pray-all"><button class="pray-btn primary" onClick={() => playAll(shown)}>
            {inTurn ? <StopIcon /> : <PlayIcon />} <span>{inTurn ? t('Stop') : `${t('Play all {n}', { n: shown.length })} · ${total(shown)}`}</span>
          </button></li>}
          {flat && shown.map(p => row(p))}
          {/* Each day is one row too; the latest one starts open, and a tap opens or folds any of them. */}
          {days.map(({ day, list: some }, i) => {
            const isOpen = dayOpen[day] ?? i === 0, stars = some.filter(isFav).length
            return <>
              <li class="pray-month pray-fold-day"><button aria-expanded={isOpen} onClick={() => { setDayOpen({ ...dayOpen, [day]: !isOpen }); setOpen(undefined); setEdit(undefined) }}>
                <strong>{dayName(day)}</strong>
                <span class="muted">{tn(some.length, '{n} prayer', '{n} prayers')} · {total(some)}{stars ? ` · ★ ${stars}` : ''}</span>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" class={isOpen ? 'open' : ''}><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button></li>
              {/* The whole day at once, oldest first: optional, like every share. */}
              {isOpen && some.length > 1 && leftToShare(some) && <li class="pray-day"><button class="pray-day-share" onClick={() => shareWithCircle({ prayers: some.map(p => p.id).reverse() })}>
                <CircleIcon size={22} /> <span>{t('Share all {n}', { n: some.length })}</span>
              </button></li>}
              {isOpen && some.map(p => row(p))}
            </>
          })}
          {/* Earlier months: one row each, opened with a tap. */}
          {months.map(({ month, list: some }) => {
            const isOpen = unfolded.includes(month), stars = some.filter(isFav).length
            return <>
              <li class="pray-month"><button aria-expanded={isOpen} onClick={() => setUnfolded(isOpen ? unfolded.filter(m => m !== month) : [...unfolded, month])}>
                <strong>{monthName(month)}</strong>
                <span class="muted">{tn(some.length, '{n} prayer', '{n} prayers')} · {total(some)}{stars ? ` · ★ ${stars}` : ''}</span>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" class={isOpen ? 'open' : ''}><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button></li>
              {isOpen && some.map(p => row(p, true))}
            </>
          })}
        </ol>
      )}
      <PrayerSync onChange={onChange} onClose={onClose} />
    </div>
  )
}

const PlayIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
const StopIcon = () => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>

/** "October 2026", from 2026-10. */
function monthName(month: string) {
  const [y, m] = month.split('-').map(Number)
  const s = new Date(y, m - 1, 1, 12).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
  return s[0].toUpperCase() + s.slice(1)
}

/** "Today", "Yesterday", or the day itself (2026-10-24 on this device's clock). */
function dayName(day: string) {
  if (day === dayOf()) return t('Today')
  if (day === dayBefore(dayOf())) return t('Yesterday')
  const [y, m, d] = day.split('-').map(Number), date = new Date(y, m - 1, d, 12)
  const s = date.toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric', ...(y === new Date().getFullYear() ? {} : { year: 'numeric' }) })
  return s[0].toUpperCase() + s.slice(1)
}

const pad = (n: number) => String(n).padStart(2, '0')
function fileName(at: number) {
  const d = new Date(at)
  return `${t('Prayer')} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`
}
const extension = (type: string) => type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'

// Sync with your other devices: off until you turn it on, here.
// Removing a home-screen web app on iPhone deletes its storage, prayers included.
const LOCAL_ONLY = N_('Until then, your prayers live only in this copy of the app. Removing it from your Home Screen, or clearing website data, deletes them.')

function PrayerSync({ onChange, onClose }: { onChange: () => void; onClose: () => void }) {
  const [on, setOn] = useState(prayerSyncOn)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [code, setCode] = useState('')
  const [shown, setShown] = useState('')
  if (!SYNC_URL) return null
  const signedIn = !!loadAccount()

  const act = (fn: () => Promise<void>) => async () => {
    setBusy(true); setMsg('')
    try { await fn() } catch (e) {
      const m = (e as Error).message
      setMsg(m === 'Cancelled' ? t('The passkey request was canceled. Tap to try again.') : m)
    } finally { setBusy(false); setOn(prayerSyncOn()); onChange() }
  }
  const start = act(async () => {
    const r = await turnOnPrayerSync(needCode ? code : undefined)
    setNeedCode(r === 'needCode')
    if (r === 'on') { setCode(''); setMsg(t('Your prayers now sync with your other devices.')) }
  })
  const stop = act(async () => { await turnOffPrayerSync(); setShown(''); setMsg(t('Prayers stay on this device and stop syncing here.')) })

  return (
    <div class="pray-sync">
      {on ? <>
        <p><strong>✓ {t('Synced with your devices.')}</strong> <span class="muted">{t('Encrypted, so only you can hear them.')}</span></p>
        <DeviceLink class="pray-link" />
        <details class="account-more">
          <summary>{t('More')}</summary>
          {shown && <p class="pray-key"><code>{shown.replace(/-/g, '-\u200B')}</code></p>}
          {/* Prayers sync by themselves each time this opens, so there's no Sync now. */}
          {shown
            ? <>
              <button class="pray-btn" onClick={() => navigator.clipboard?.writeText(shown).then(() => setMsg(t('Copied.')), () => {})}>{t('Copy prayer key')}</button>
              {/* From your own mail app, so the key never passes through the sync server. */}
              <a class="pray-btn" href={`mailto:?subject=${encodeURIComponent(t('My Quiet Bible prayer key'))}&body=${encodeURIComponent(
                t('My Quiet Bible prayer key:') + `\n\n${shown}\n\n` + t('It unlocks my synced prayers on a new device (Your prayers → Sync my prayers). Keep it private.'))}`}>{t('Email it to myself')}</a>
            </>
            : <button class="pray-btn" onClick={() => prayerKeyCode().then(setShown)}>{t('Show prayer key')}</button>}
          {shown && <p class="muted small">{t('Only needed on a device that can’t unlock your prayers by itself: one where you sign in by email, or whose passkey can’t. Easier: Link another device. Keep the key private: it opens your prayers. Emailed to yourself, it’s there if you ever lose this phone.')}</p>}
          <button class="pray-btn quiet" disabled={busy} onClick={stop}>{busy ? t('Stopping…') : t('Stop syncing on this device')}</button>
        </details>
      </> : !signedIn ? <>
        <p class="muted">{t('To keep your prayers on all your devices, sign in first. They’re encrypted on this device before they leave it.')}</p>
        <p class="muted small">{t(LOCAL_ONLY)}</p>
        <button class="pray-btn" onClick={() => { onClose(); openSettings() }}>{t('Go to Settings → Account')}</button>
      </> : needCode ? <>
        <p class="muted">{t('This device can’t unlock your prayers by itself yet. Let one where they already sync allow it:')}</p>
        <AskApproval btn="pray-btn" onDone={() => { setNeedCode(false); act(async () => { if (await turnOnPrayerSync() === 'on') setMsg(t('Your prayers now sync with your other devices.')) })() }} />
        <p class="muted small">{t('Or paste the prayer key from there (Your prayers → More → Show prayer key):')}</p>
        <input class="pray-code" value={code} onInput={e => setCode((e.target as HTMLInputElement).value)} placeholder={t('Prayer key')}
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellcheck={false} />
        <button class="pray-btn primary" disabled={busy || !code.trim()} onClick={start}>{busy ? t('Unlocking…') : t('Unlock')}</button>
        <button class="pray-btn" onClick={() => { setNeedCode(false); setMsg('') }}>{t('Cancel')}</button>
      </> : <>
        <p class="muted">{t('Keep your prayers on all your devices. Each one is encrypted on this device before it leaves it, so no one else, not even the server, can hear it.')}</p>
        <button class="pray-btn primary" disabled={busy} onClick={start}>{busy ? t('Waiting for passkey…') : t('Sync my prayers')}</button>
        <p class="muted small">{t(LOCAL_ONLY)}</p>
      </>}
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

/** A quiet word after Amen, from the second day in a row. */
function PrayStreak() {
  const n = streak(loadDays(), PRAY)
  return n > 1 ? <p class="pray-streak">{tn(n, '{n} day of prayer in a row', '{n} days of prayer in a row')}</p> : null
}
