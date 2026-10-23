// End-to-end encryption for synced prayers. Each account has one prayer key,
// made on the first device that turns sync on and never sent to the server
// as is. Devices get it either from their passkey (the WebAuthn PRF
// extension gives a secret only that passkey can produce, which unwraps a
// copy kept on the server) or from the key written out as a code.

const enc = new TextEncoder(), dec = new TextDecoder()
const subtle = () => globalThis.crypto.subtle

// ---- the key as a code you can write down ------------------------------------

/** Crockford base32: no I, L, O or U, so it reads back without mistakes. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const KEY_BYTES = 20

export const newKey = () => globalThis.crypto.getRandomValues(new Uint8Array(KEY_BYTES))

/** 20 bytes as 32 characters, in groups of four: 7K2Q-… */
export function keyCode(key: Uint8Array) {
  let bits = 0, value = 0, out = ''
  for (const b of key) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits) out += ALPHABET[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)!.join('-')
}

/** The key from a code as typed: any case, spaces or dashes, and the usual
 *  look-alikes (O for 0, I or L for 1). Undefined if it isn't a whole key. */
export function parseKeyCode(s: string): Uint8Array | undefined {
  const t = s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (t.length !== Math.ceil(KEY_BYTES * 8 / 5) || [...t].some(c => !ALPHABET.includes(c))) return
  const out = new Uint8Array(KEY_BYTES)
  let bits = 0, value = 0, i = 0
  for (const c of t) {
    value = (value << 5) | ALPHABET.indexOf(c); bits += 5
    if (bits >= 8) { out[i++] = (value >>> (bits - 8)) & 255; bits -= 8 }
  }
  return out
}

// ---- keys --------------------------------------------------------------------

export const b64url = {
  encode(bytes: Uint8Array) {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(s: string) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
    return Uint8Array.from(bin, c => c.charCodeAt(0))
  },
}

async function hkdf(secret: Uint8Array, info: string, bits: number) {
  const base = await subtle().importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('plain-bible'), info: enc.encode(info) }, base, bits))
}
const aesKey = async (secret: Uint8Array, info: string) =>
  subtle().importKey('raw', await hkdf(secret, info, 256) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])

export interface PrayerKey { key: CryptoKey; id: string }
/** The encryption key and its public fingerprint, from the key bytes. */
export async function prayerKey(raw: Uint8Array): Promise<PrayerKey> {
  return { key: await aesKey(raw, 'prayers v1'), id: b64url.encode(await hkdf(raw, 'prayers v1 id', 128)) }
}

// ---- sealing -----------------------------------------------------------------

/** version byte, 12-byte IV, AES-GCM ciphertext. `aad` ties it to its place. */
export async function seal(key: CryptoKey, plain: Uint8Array, aad: string): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, plain as BufferSource))
  const out = new Uint8Array(13 + ct.length)
  out[0] = 1; out.set(iv, 1); out.set(ct, 13)
  return out
}
export async function open(key: CryptoKey, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
  if (sealed[0] !== 1) throw new Error('Unknown format')
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: sealed.slice(1, 13), additionalData: enc.encode(aad) }, key, sealed.slice(13) as BufferSource))
}

/** The prayer key, wrapped with a passkey's PRF secret. */
export async function wrapKey(raw: Uint8Array, prf: Uint8Array) {
  return b64url.encode(await seal(await aesKey(prf, 'prayer key wrap v1'), raw, 'wrap'))
}
export async function unwrapKey(wrapped: string, prf: Uint8Array) {
  return open(await aesKey(prf, 'prayer key wrap v1'), b64url.decode(wrapped), 'wrap')
}

// ---- one recorded part, with what it needs to stand alone ---------------------

export interface PartHead { at: number; ms: number; type: string }
export function packPart(head: PartHead, audio: ArrayBuffer): Uint8Array {
  const h = enc.encode(JSON.stringify(head))
  const out = new Uint8Array(4 + h.length + audio.byteLength)
  new DataView(out.buffer).setUint32(0, h.length)
  out.set(h, 4); out.set(new Uint8Array(audio), 4 + h.length)
  return out
}
export function unpackPart(b: Uint8Array): { head: PartHead; audio: ArrayBuffer } {
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0)
  const head = JSON.parse(dec.decode(b.subarray(4, 4 + n))) as PartHead
  return { head, audio: b.slice(4 + n).buffer }
}

/** The salt the passkey hashes into its PRF secret. Fixed: the same passkey
 *  must give the same secret on every device. */
export const PRF_SALT = enc.encode('plain-bible prayers prf v1')
