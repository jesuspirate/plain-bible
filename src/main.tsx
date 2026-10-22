import { render } from 'preact'
import { App } from './app'
import './fonts'
import './styles.css'

render(<App />, document.getElementById('app')!)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {})
}
