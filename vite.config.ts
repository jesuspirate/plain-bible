import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'
import { LANGS } from './src/i18n'

// Shown in Settings, so you can tell which version you have: the day it was
// built and its commit.
const sha = (process.env.GITHUB_SHA || '').slice(0, 7)
const BUILD = new Date().toISOString().slice(0, 10) + (sha ? ' · ' + sha : '')

// The test site (scripts/deploy_test_site.sh): named so it can't be mistaken
// for the real app, in a browser tab or on a Home Screen.
const TEST_SITE = !!process.env.VITE_TEST_SITE

const manifest = {
  name: TEST_SITE ? 'TEST My Quiet Bible' : 'My Quiet Bible',
  short_name: TEST_SITE ? 'MQB Test' : 'My Quiet Bible',
  description: 'Read, pray, share, repeat. The Bible in many versions and languages, prayer with one button, and private circles to share it.',
  theme_color: '#2b2a28',
  background_color: '#f4ecd8',
  display: 'standalone' as const,
  // Store listings read these (the Microsoft Store package via PWABuilder).
  categories: ['books', 'education', 'lifestyle'],
  // The app's lasting identity (the same address it always had), which the
  // Google Play app (android/) and installed copies share.
  id: '/',
  start_url: './',
  scope: './',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

// How many versions and languages there are, for the pages' own words, from
// the catalog the data build writes (CI builds the data before the app).
// Without it (a quick local build), the count when this was last changed.
function catalogCounts() {
  try {
    const { translations } = JSON.parse(readFileSync(new URL('./public/data/catalog.json', import.meta.url), 'utf8')) as { translations: { lang: string }[] }
    return { versions: translations.length, languages: new Set(translations.map(t => t.lang)).size }
  } catch { return { versions: 162, languages: 85 } }
}
const counts = catalogCounts()

// One copy of the manifest per theme. Android paints the installed app's
// window in its background color, and that shows for a moment behind the
// keyboard as it slides up or down; a cream window flashed white in Dark.
// The app points at the copy for the theme in use (src/app.tsx), so the
// home-screen app takes the color of the theme it was installed in.
const THEMES = { light: '#faf8f3', sepia: '#f4ecd8', dark: '#16161a' }
const themedManifests: Plugin = {
  name: 'themed-manifests',
  enforce: 'post',
  generateBundle() {
    for (const [id, bg] of Object.entries(THEMES)) {
      this.emitFile({ type: 'asset', fileName: `manifest-${id}.webmanifest`, source: JSON.stringify({ ...manifest, background_color: bg }) })
    }
  },
  // The PWA plugin links the manifest from every page as ./manifest.webmanifest,
  // which from /welcome/ points at nothing. The welcome page links the root's
  // (sepia, the default; welcome/welcome.ts switches with the theme).
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      if (TEST_SITE) html = html.replace('<title>', '<title>TEST · ').replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*/, '$1MQB Test')
      html = html.replaceAll('{{versions}}', String(counts.versions)).replaceAll('{{languages}}', String(counts.languages))
        // The languages the welcome and support pages speak, for their first paint.
        .replaceAll('{{langIds}}', LANGS.map(l => l.id).join('|')).replaceAll('{{rtlIds}}', LANGS.filter(l => l.rtl).map(l => l.id).join('|') || '-')
      return /^\/(welcome|support)\//.test(ctx.path) ? html.replace('href="./manifest.webmanifest"', 'href="../manifest-sepia.webmanifest"') : html
    },
  },
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  // Relative base works on a custom domain and on a GitHub Pages project path.
  base: './',
  // Three pages: the Bible at the root, the welcome page at /welcome/
  // (what My Quiet Bible is, and how to put it on a Home Screen), and the
  // support page at /support/ (how to give). Built together, so the other
  // pages share the app's fonts and are saved offline with it.
  build: { rollupOptions: { input: { main: 'index.html', welcome: 'welcome/index.html', support: 'support/index.html' } } },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest,
      workbox: {
        // A new version waits until the app switches to it (src/lib/update.ts),
        // so a page never runs half old and half new.
        skipWaiting: false,
        clientsClaim: false,
        // Notifications for circles (public/push-sw.js).
        importScripts: ['push-sw.js'],
        // Of the languages' words (public/i18n), only French and Spanish come
        // with the app; each other language is fetched by those who read in it.
        globPatterns: ['**/*.{js,css,html,svg,png}', 'i18n/*/{fr,es}.json'],
        // The picture for shared links is for other apps to fetch, not part of the offline Bible.
        // Nor is the QR drawing, which only the support page loads, and only once Bitcoin is set up there.
        globIgnores: ['share.png', '**/qrcode-*.js'],
        // /welcome and /support without the slash are the site's redirects to the pages, not ones the app should answer for.
        // Nor is /stats, the easy address for the private numbers page (.github/workflows/deploy.yml).
        navigateFallbackDenylist: [/\/welcome$/, /\/support$/, /\/stats\/?$/],
        runtimeCaching: [
          {
            // Bibles you open, or save from the Versions page, stay available offline,
            // and so does a word dictionary once you've looked up a word (src/define.tsx).
            urlPattern: ({ url }) => /\/data\/(bibles\/|strongs-)|\/dict\/\w+\.json$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'bible-data', cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // A language's words (src/i18n.ts): kept once fetched, so the app
            // starts in its language offline with no wait, and refreshed in
            // the background for the next start.
            urlPattern: ({ url }) => /\/i18n\/\w+\/[\w-]+\.json$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'words', cacheableResponse: { statuses: [200] } },
          },
          {
            // Fonts: only the scripts and styles actually used get downloaded.
            urlPattern: ({ url }) => url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts' },
          },
          {
            // The list of versions: always fresh when online, so new versions appear right away.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/catalog.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bible-catalog', networkTimeoutSeconds: 4,
              // An error page (say a 404 while the site is mid-update) counts as
              // offline, so the saved copy is used instead.
              plugins: [{ fetchDidSucceed: async ({ response }) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response } }],
            },
          },
        ],
      },
    }),
    themedManifests,
    // Which version is on the site, for copies of the app with no service
    // worker to ask (Fedi's mini apps on iPhone): see src/lib/update.ts.
    { name: 'version-file', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) }) } } as Plugin,
  ],
  worker: { format: 'es' },
})
