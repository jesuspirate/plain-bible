import { Component, render } from 'preact'
import { App } from './app'
import './fonts'
import './styles.css'
import { warmSearch } from './searchClient'
import { newVersionReady, registered } from './lib/update'
import { Arriving } from './move'
import { parseMoveLink } from './lib/move'
import { savedLang, setLang, t } from './i18n'

// The reader puts you back on your verse itself; the browser's own scroll
// restoration would fight it.
// The code loaded, so the blank-page guard in index.html can stand down.
const w = window as { plainBibleStarted?: boolean; plainBibleRepair?: () => void; plainBibleWelcome?: boolean }
w.plainBibleStarted = true
document.getElementById('boot-stuck')?.remove()

if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

// Safari on iPhone only shows a button as pressed (:active) when the page
// listens for touches; without this, taps there give no feedback at all.
document.addEventListener('touchstart', () => {}, { passive: true })

// Without this, an error while drawing the page leaves it blank. Show what
// went wrong instead, so it can be reported, and a way back.
class Crash extends Component<{}, { error?: Error }> {
  componentDidCatch(error: Error) { this.setState({ error }) }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div class="center">
        <p class="error">{t('Something went wrong: {error}', { error: String(error.message || error) })}</p>
        <p>{t('Your highlights and settings are safe on this device.')}</p>
        <p><button onClick={() => location.reload()}>{t('Reload')}</button></p>
        {/* Clears the saved app files (not your data) and loads a fresh copy. */}
        {w.plainBibleRepair && <p><button onClick={w.plainBibleRepair}>{t('Repair and reload')}</button></p>}
      </div>
    )
  }
}

// A move link from the old address: bring everything over first, then start.
const moving = location.hash.startsWith('#/move/') ? parseMoveLink(location.hash) : undefined
if (location.hash.startsWith('#/move/') && !moving) history.replaceState(null, '', location.pathname + '#/read')
// A first visit is on its way to the welcome page (index.html): nothing to start.
// In French or Spanish, their words come in first (a small file, saved
// offline with the app); English needs nothing.
const start = () => render(<Crash>{moving ? <Arriving link={moving} /> : <App />}</Crash>, document.getElementById('app')!)
const lang = savedLang()
// A device link opened while the app is already running (macOS sends an
// AirDropped link to the open Dock app): start over so it's taken in.
addEventListener('hashchange', () => { if (location.hash.startsWith('#/move/')) location.reload() })
if (!w.plainBibleWelcome) { if (lang === 'en') start(); else setLang(lang).catch(() => {}).then(start) }

if (import.meta.env.PROD && 'serviceWorker' in navigator && !w.plainBibleWelcome) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedReload: newVersionReady,
      onRegisteredSW(_url, reg) {
        registered(reg)
      },
    })
  }).catch(() => {})
  // Start the search worker once the page is up. Its file belongs to this
  // version, and after an update (until the reload) the site only has the
  // new one, so it has to be fetched while it is still there.
  setTimeout(warmSearch, 2000)
}
