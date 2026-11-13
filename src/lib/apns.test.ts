// The sync service's Apple push (worker/src/apns.ts), for the App Store iPhone app.
import { describe, expect, it } from 'vitest'
import { APNS_TOKEN, apnsBody, apnsJwt, isApnsEnv } from '../../worker/src/apns'
import { askNative } from './nativeNotify'

const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0))

async function p8() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer)
  const body = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')
  return { pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`, pub: pair.publicKey }
}

describe('apple push', () => {
  it('signs a token Apple can check, and keeps it for a while', async () => {
    const { pem, pub } = await p8()
    const a = { p8: pem, keyId: 'ABC123DEFG', teamId: 'TEAM123456', topic: 'com.myquietbible.ios' }
    const now = 1_800_000_000_000
    const jwt = await apnsJwt(a, now)
    const [h, c, sig] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(unb64(h)))).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' })
    expect(JSON.parse(new TextDecoder().decode(unb64(c)))).toEqual({ iss: 'TEAM123456', iat: 1_800_000_000 })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64(sig), new TextEncoder().encode(`${h}.${c}`))
    expect(ok).toBe(true)
    // Same token within 40 minutes, a new one after.
    expect(await apnsJwt(a, now + 30 * 60_000)).toBe(jwt)
    expect(await apnsJwt(a, now + 41 * 60_000)).not.toBe(jwt)
  })

  it('says only which circle, quietly', () => {
    const b = apnsBody('circle-abc123')
    expect(b.c).toBe('circle-abc123')
    expect(b.aps['mutable-content']).toBe(1)
    expect(b.aps).not.toHaveProperty('sound')
    expect(b.aps).not.toHaveProperty('badge')
  })

  it('takes only real device tokens and the two Apple servers', () => {
    expect(APNS_TOKEN.test('a'.repeat(64))).toBe(true)
    expect(APNS_TOKEN.test('../'.repeat(30))).toBe(false)
    expect(APNS_TOKEN.test('A'.repeat(64))).toBe(false)
    expect(isApnsEnv('production') && isApnsEnv('sandbox')).toBe(true)
    expect(isApnsEnv('https://evil.example')).toBe(false)
  })

  it('asks the iPhone app, and an older app answers nothing', async () => {
    expect(await askNative({ op: 'register' }, undefined)).toBeUndefined()
    expect(await askNative({ op: 'register' }, { postMessage: async () => { throw new Error('no') } })).toBeUndefined()
    expect(await askNative({ op: 'register' }, { postMessage: async () => ({ apns: 'ab', env: 'production' }) })).toEqual({ apns: 'ab', env: 'production' })
  })
})
