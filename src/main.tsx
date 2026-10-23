import { Component, render } from 'preact'
import { App } from './app'
import './fonts'
import './styles.css'
import { initNative, isNative } from './lib/native'

// The reader puts you back on your verse itself; the browser's own scroll
// restoration would fight it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

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
      </div>
    )
  }
}

render(<Crash><App /></Crash>, document.getElementById('app')!)
initNative()

// The iOS app ships its files inside the app, so it needs no service worker.
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    // Check for a new version whenever the app comes back to the foreground,
    // so an installed app picks up updates without being force-closed.
    registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) {
        if (reg) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
      },
    })
  }).catch(() => {})
}
