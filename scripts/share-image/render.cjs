// Turns banner.html into public/share.png, the 1200×630 picture that
// messages and social apps show for a shared link. Needs Playwright (not a
// dependency of the app). Run after changing the banner:
//   node scripts/share-image/render.cjs
const { chromium } = require('playwright')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const page = pathToFileURL(path.join(__dirname, 'banner.html')).href
const out = path.join(__dirname, '../../public/share.png')

;(async () => {
  const browser = await chromium.launch()
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await tab.goto(page)
  await tab.evaluate(() => document.fonts.ready)
  await tab.screenshot({ path: out })
  await browser.close()
  console.log('wrote', out)
})()
