import { Component, render } from 'preact'
import { App } from './app'
import './fonts'
import './styles.css'
import { initNative, isNative } from './lib/native'
import { warmSearch } from './searchClient'
import { newVersionReady, registered } from './lib/update'

// The reader puts you back on your verse itself; the browser's own scroll
// restoration would fight it.
// The code loaded, so the blank-page guard in index.html can stand down.
const w = window as { plainBibleStarted?: boolean; plainBibleRepair?: () => void }
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
        <p class="error">Something went wrong: {String(error.message || error)}</p>
        <p>Your highlights and settings are safe on this device.</p>
        <p><button onClick={() => location.reload()}>Reload</button></p>
        {/* Clears the saved app files (not your data) and loads a fresh copy. */}
        {w.plainBibleRepair && <p><button onClick={w.plainBibleRepair}>Repair and reload</button></p>}
      </div>
    )
  }
}

render(<Crash><App /></Crash>, document.getElementById('app')!)
initNative()

// The iOS app ships its files inside the app, so it needs no service worker.
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedReload: newVersionReady,
      onRegisteredSW(_url, reg) {
        registered(reg)
        // Check for a new version whenever the app comes back to the
        // foreground, so an installed app picks up updates without being
        // force-closed.
        if (reg) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
      },
    })
  }).catch(() => {})
  // Start the search worker once the page is up. Its file belongs to this
  // version, and after an update (until the reload) the site only has the
  // new one, so it has to be fetched while it is still there.
  setTimeout(warmSearch, 2000)
}
