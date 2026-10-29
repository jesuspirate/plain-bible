// Putting the Bible on the Home Screen. Opened in a phone's browser, the app
// offers it once in a while (install.tsx shows how); on the Home Screen,
// never. Small and loaded with the app, so Chrome's one-tap install offer,
// which comes only once, early, isn't missed.

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { standalone?: boolean }
const mode = (m: string) => typeof matchMedia !== 'undefined' && matchMedia(`(display-mode: ${m})`).matches

export const isIPhone = () => /iPhone|iPad|iPod/.test(nav.userAgent ?? '')
  // iPads ask for the desktop site and call themselves a Mac.
  || (/Macintosh/.test(nav.userAgent ?? '') && (nav.maxTouchPoints ?? 0) > 1)
export const isAndroid = () => /Android/.test(nav.userAgent ?? '')
/** Already on a Home Screen (or in its own window on a computer). */
export const installed = () => nav.standalone === true || mode('standalone') || mode('fullscreen') || mode('minimal-ui')

let offer: InstallPrompt | undefined
export const INSTALL_EVENT = 'plain-bible:install'
if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); offer = e as InstallPrompt; dispatchEvent(new Event(INSTALL_EVENT)) })
  addEventListener('appinstalled', () => { offer = undefined; done(); dispatchEvent(new Event(INSTALL_EVENT)) })
}
/** The browser can install it in one tap (Chrome, Edge, Samsung Internet). */
export const canInstall = () => !!offer
export async function installNow(): Promise<boolean> {
  const o = offer
  if (!o) return false
  offer = undefined
  await o.prompt()
  const { outcome } = await o.userChoice
  if (outcome === 'accepted') done()
  dispatchEvent(new Event(INSTALL_EVENT))
  return outcome === 'accepted'
}

/** Opens the steps from Settings, any time. */
export const HOME_SCREEN_EVENT = 'plain-bible:home-screen'
export const openHomeScreen = () => dispatchEvent(new Event(HOME_SCREEN_EVENT))

// Shown by itself at most three times, three days apart; then only from Settings.
const KEY = 'plain-bible:home-screen'
const DAY = 864e5
type Seen = { n: number; at: number; done?: boolean }
const seen = (): Seen => { try { return { n: 0, at: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { n: 0, at: 0, done: true } } }
const save = (s: Seen) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ } }
function done() { save({ ...seen(), done: true }) }
export function homeScreenDue(now = Date.now()) {
  if (installed() || !(isIPhone() || isAndroid())) return false
  const s = seen()
  return !s.done && s.n < 3 && now - s.at > 3 * DAY
}
export const markHomeScreenShown = (now = Date.now()) => { const s = seen(); save({ ...s, n: s.n + 1, at: now }) }
