// Draws the prayer map's dots (src/lib/worldDots.ts): the world as a quiet
// grid of dots, each dot tagged with the country it falls in, by the
// two-letter code Cloudflare gives a request (see the worker's /world).
// Run once; the app never fetches a map.
//
//   npm i --no-save world-atlas@2 topojson-client@3 d3-geo@3 i18n-iso-countries@7
//   node scripts/world_dots.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { feature } from 'topojson-client'
import { geoContains, geoEqualEarth, geoPath } from 'd3-geo'
const require = createRequire(import.meta.url)
const iso = require('i18n-iso-countries')
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'))
// Places Natural Earth draws without a code: counted with the code Cloudflare uses.
const NAMED = { Somaliland: 'SO', Kosovo: 'XK', 'N. Cyprus': 'CY' }
const code = f => NAMED[f.properties.name] ?? (f.id ? iso.numericToAlpha2(f.id) : undefined)
const all = feature(topo, topo.objects.countries).features.filter(code)
const W = 360, H = 175, STEP = 2.8
const proj = geoEqualEarth().fitExtent([[4, 4], [W - 4, H - 4]], { type: 'Sphere' })
const dots = {}, small = new Set()
const cols = Math.floor(W / STEP), rows = Math.floor(H / STEP)
for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
  const p = proj.invert([(i + 0.5) * STEP, (j + 0.5) * STEP])
  if (!p || p[1] < -58) continue // no Antarctica: nobody prays there for long
  const f = all.find(f => geoContains(f, p))
  if (f) (dots[code(f)] ??= []).push(i, j)
}
// Countries too small for the grid get one dot where they are.
for (const f of all) {
  const c = code(f)
  if (dots[c]) continue
  const [x, y] = geoPath(proj).centroid(f)
  if (!isFinite(x) || proj.invert([x, y])[1] < -58) continue
  dots[c] = [Math.round(x / STEP - 0.5), Math.round(y / STEP - 0.5)]
  small.add(c)
}
const sorted = Object.fromEntries(Object.entries(dots).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync('src/lib/worldDots.ts', `// Made by scripts/world_dots.mjs from Natural Earth (public domain), through world-atlas.
// Each country: its dots as column, row pairs on a ${cols} × ${rows} grid.
export const COLS = ${cols}, ROWS = ${rows}
/** Countries drawn as one dot, made bigger once they light up so they show. */
export const SMALL = new Set(${JSON.stringify([...small].sort())})
export const DOTS: Record<string, number[]> = ${JSON.stringify(sorted)}
`)
console.log(Object.keys(sorted).length, 'countries', small.size, 'small')
