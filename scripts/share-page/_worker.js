// share.myquietbible.com (worker/src/share.ts). Bundled by wrangler on deploy.
import { answer } from '../../worker/src/share.ts'
import cards from './cards.js'

// Bible files change rarely: keep them a day at Cloudflare's edge.
const get = url => fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } })

export default { fetch: req => answer(req, get, cards) }
