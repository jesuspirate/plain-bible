import { render } from 'preact'
import { App } from './app'
import './fonts'
import './styles.css'

render(<App />, document.getElementById('app')!)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
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
