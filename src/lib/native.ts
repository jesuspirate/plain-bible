// The iOS app is the same web app running inside a native shell (Capacitor).
// Everything here is a no-op on the web, so the PWA behaves exactly as before.
import { Capacitor } from '@capacitor/core'
import { WEB_URL } from './site'

export { WEB_URL }
export const isNative = Capacitor.isNativePlatform()

/** A link to `hash` (e.g. `#/KJV/JHN/3/16`) that opens in any browser. */
export function shareLink(hash: string) {
  return isNative ? WEB_URL + hash : `${location.origin}${location.pathname}${hash}`
}

export const canShare = isNative || 'share' in navigator

/** Safari on iPhone or iPad (iPads say they're Macs, but have touch). */
export const isIOS = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export async function share(o: { title: string; text: string; url?: string }) {
  if (isNative) {
    const { Share } = await import('@capacitor/share')
    await Share.share({ title: o.title, text: o.text, url: o.url, dialogTitle: o.title }).catch(() => {})
  } else {
    await navigator.share(o).catch(() => {})
  }
}

export async function copyText(s: string) {
  if (isNative) {
    const { Clipboard } = await import('@capacitor/clipboard')
    await Clipboard.write({ string: s })
  } else {
    await navigator.clipboard.writeText(s)
  }
  tap()
}

/** A light tap of the haptic engine, for highlights, bookmarks and copies. */
export function tap() {
  if (!isNative) return
  import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {})
}

/** The buzz of a press-and-hold, like holding a key on the iPhone keyboard.
 *  The web has no haptics API on iPhone, but tapping a hidden switch
 *  (iOS 18 and later) gives the same small tick; Android can vibrate. */
let tick: HTMLLabelElement | undefined
export function holdTap() {
  if (isNative) {
    import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Medium })).catch(() => {})
  } else if (navigator.vibrate) {
    navigator.vibrate(12)
  } else {
    if (!tick) {
      tick = document.createElement('label')
      tick.setAttribute('aria-hidden', 'true')
      tick.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none'
      const box = document.createElement('input')
      box.type = 'checkbox'; box.setAttribute('switch', ''); box.tabIndex = -1
      tick.append(box)
      document.body.append(tick)
    }
    tick.click()
  }
}

/** Set up the native shell: status bar text that suits the theme, and hide
 *  the launch screen once the first chapter is on screen. */
export async function initNative() {
  if (!isNative) return
  document.documentElement.classList.add('native')
  const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([import('@capacitor/status-bar'), import('@capacitor/splash-screen')])
  const root = document.documentElement
  let last = ''
  const tint = () => {
    // Light text on dark themes, dark text on light and sepia.
    const style = luminance(getComputedStyle(root).getPropertyValue('--bg')) < 0.4 ? Style.Dark : Style.Light
    if (style !== last) { last = style; StatusBar.setStyle({ style }).catch(() => {}) }
  }
  new MutationObserver(tint).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', tint)
  tint()
  // A clean keyboard: no arrows and Done bar above it, as in other iPhone apps.
  import('@capacitor/keyboard').then(({ Keyboard }) => Keyboard.setAccessoryBarVisible({ isVisible: false })).catch(() => {})
  setTimeout(() => SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {}), 150)
}

function luminance(color: string) {
  const m = color.trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) return 1
  const n = parseInt(m[1], 16)
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}
