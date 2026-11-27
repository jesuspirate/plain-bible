// The Bible switcher, inside the search bar beside the place you're reading
// ("John 3   [BSB]"), so the top right keeps only the history clock and
// Settings. A tap switches to the Bible you read before (and a second tap
// back again: handy to hear a verse in both). Press and hold (or
// right-click) for the ones you use, and the full list one row below.
// Either way it's your pick, so it becomes your Bible, as in Settings.
import { useEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { go, readPath, useApp, useRoute } from './state'
import { recentVersions, rememberVersion, VersionPicker } from './ui'
import { useLeave } from './motion'
import { t } from './i18n'

export function VersionSwitch() {
  const route = useRoute()
  const { settings, update, byId, catalog } = useApp()
  const [peek, setPeek] = useState<{ bottom: number; right: number }>()
  const [all, setAll] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const hold = useRef<{ timer: number; fired: boolean }>()
  const leave = useLeave(box)
  const reading = route.path[0] === 'read' && route.path.length >= 4
  const version = reading && byId.has(route.path[1]) ? route.path[1] : settings.version
  const parallel = ((reading && route.params.get('p')?.split(',')) || settings.parallel).filter(id => byId.has(id))
  const before = recentVersions().find(id => id !== version && byId.has(id))
  const yours = [...new Set([version, ...recentVersions(), ...settings.myVersions])].filter(id => byId.has(id)).slice(0, 5)

  // The list rises from the bar, its right edge over the pill.
  const show = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const w = Math.min(340, innerWidth - 24)
    setPeek({ bottom: innerHeight - r.top + 10, right: Math.max(12, Math.min(innerWidth - r.right - 60, innerWidth - w - 12)) })
  }
  const down = () => { hold.current = { fired: false, timer: window.setTimeout(() => { hold.current!.fired = true; show() }, 450) } }
  const up = () => clearTimeout(hold.current?.timer)
  const choose = (v: string) => {
    setPeek(undefined)
    if (v === version) return
    rememberVersion(version); rememberVersion(v)
    const others = parallel.filter(id => id !== v)
    update({ version: v, parallel: others })
    if (reading) go(readPath(v, route.path[2], +route.path[3], +(route.params.get('v') || 0) || undefined, others), true)
    else go('read/' + v)
  }

  useEffect(() => { setPeek(undefined) }, [route.path.join('/')])
  useEffect(() => {
    if (!peek) return
    // A tap outside just closes the list; it doesn't also select the verse
    // or press the button underneath.
    const away = (e: Event) => {
      const n = e.target as Node
      if (box.current?.contains(n) || btn.current?.contains(n)) return
      setPeek(undefined)
      const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault() }
      addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => removeEventListener('click', stop, { capture: true }), 600)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPeek(undefined) }
    addEventListener('pointerdown', away); addEventListener('keydown', esc); addEventListener('scroll', away as never, { passive: true })
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', esc); removeEventListener('scroll', away as never) }
  }, [peek])

  return (
    <>
      <button ref={btn} type="button" class={'sb-version' + (peek ? ' on' : '')} aria-expanded={!!peek}
        aria-label={before ? t('Switch to {version}. Hold for your Bibles', { version: before }) : t('Bible versions')}
        title={before ? t('Switch to {version} · hold for more', { version: before }) : t('Bible versions')}
        onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
        onContextMenu={e => { e.preventDefault(); up(); show() }}
        onClick={() => { if (hold.current?.fired) return; if (before) choose(before); else if (peek) setPeek(undefined); else show() }}>
        {version}
      </button>
      {/* Out of the bar: its glass would hold anything fixed inside it. */}
      {peek && createPortal(
        <div ref={leave} class="peek vpeek up" role="dialog" aria-label={t('Bible versions')}
          style={{ bottom: peek.bottom + 'px', right: peek.right + 'px' }}>
          {yours.map(id => (
            <button class={'vpeek-row' + (id === version ? ' on' : '')} aria-current={id === version} onClick={() => choose(id)}>
              <strong>{id}</strong><span>{byId.get(id)?.name}</span>
              {id === version && <span class="vpeek-tick" aria-hidden="true">✓</span>}
            </button>
          ))}
          <button class="vpeek-all" onClick={() => { setPeek(undefined); setAll(true) }}>
            {t('All {n} versions, by language', { n: catalog.translations.length })} <span aria-hidden="true">›</span>
          </button>
        </div>, document.body)}
      {all && createPortal(<VersionPicker title={t('Version')} startAll selected={[version]} onClose={() => setAll(false)} onChange={([id]) => choose(id)} />, document.body)}
    </>
  )
}
