// OAuth 1.0a request signing (HMAC-SHA1), as X asks of an app posting as an
// account. Only the oauth_ parameters (and any query or form fields passed in
// `extra`) are signed; JSON and multipart bodies are not.
import { createHmac } from 'node:crypto'

export interface Keys { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string }

export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

export function signature(method: string, url: string, params: Record<string, string>, consumerSecret: string, tokenSecret: string) {
  const all = Object.keys(params).sort().map(k => `${pct(k)}=${pct(params[k])}`).join('&')
  const base = [method.toUpperCase(), pct(url), pct(all)].join('&')
  return createHmac('sha1', `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest('base64')
}

export function oauthHeader(method: string, url: string, k: Keys, nonce: string, timestamp: number, extra: Record<string, string> = {}) {
  const o: Record<string, string> = {
    oauth_consumer_key: k.consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp), oauth_token: k.token, oauth_version: '1.0',
  }
  o.oauth_signature = signature(method, url, { ...o, ...extra }, k.consumerSecret, k.tokenSecret)
  return 'OAuth ' + Object.keys(o).sort().map(n => `${pct(n)}="${pct(o[n])}"`).join(', ')
}
