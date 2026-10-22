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
  setTimeout(() => SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {}), 150)
}

function luminance(color: string) {
  const m = color.trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) return 1
  const n = parseInt(m[1], 16)
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}
