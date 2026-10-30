// Which circles already have each of your prayers, so the share sheet can
// grey those out and Your prayers can say where one went. A prayer is known
// by when it was prayed: a shared prayer carries that (`prayed`), on every
// device. Two sources, both kept on this device: your own prayers in each
// circle as last loaded, and what this device sent since.
// Small on purpose: Your prayers reads it without loading the circles code.

import { meta } from './prayers'

const SENT = 'prayers-shared'
export const SHARED_EVENT = 'plain-bible:prayers-shared'

/** Just what's needed of a kept circle feed. */
interface Kept { me: string; items: { by: string; body: { k: string; prayed?: number } }[] }
export interface Circle { id: string; name: string }
/** For each circle: when each of your prayers in it was prayed. */
export type SharedIn = Map<string, Set<number>>

/** Your prayers in each circle: those in its feed, and those sent from here. */
export function sharedIn(circles: Circle[], feeds: Record<string, Kept | undefined>, sent: Record<string, number[]>): SharedIn {
  const out: SharedIn = new Map()
  for (const c of circles) {
    const f = feeds[c.id], have = new Set(sent[c.id] ?? [])
    for (const i of f?.items ?? []) if (i.by === f!.me && i.body.k === 'prayer' && i.body.prayed) have.add(i.body.prayed)
    out.set(c.id, have)
  }
  return out
}

/** The circles you're in, and your prayers in each. */
export async function loadShared(): Promise<{ circles: Circle[]; shared: SharedIn }> {
  const circles = (await meta.get<Circle[]>('circles').catch(() => undefined)) ?? []
  const feeds: Record<string, Kept | undefined> = {}
  await Promise.all(circles.map(async c => { feeds[c.id] = await meta.get<Kept>(`circle:${c.id}`).catch(() => undefined) }))
  return { circles, shared: sharedIn(circles, feeds, (await meta.get<Record<string, number[]>>(SENT).catch(() => undefined)) ?? {}) }
}

/** The circles that already have every one of these prayers (by when they were prayed). */
export const circlesWithAll = (shared: SharedIn, prayed: number[]) =>
  new Set([...shared].filter(([, have]) => prayed.length > 0 && prayed.every(at => have.has(at))).map(([id]) => id))

/** Sent from this device just now. */
export async function keepSent(circle: string, prayed: number) {
  const all = (await meta.get<Record<string, number[]>>(SENT)) ?? {}
  if (all[circle]?.includes(prayed)) return
  await meta.set(SENT, { ...all, [circle]: [...(all[circle] ?? []), prayed] })
}

/** Taken back out of a circle: not in it any more. */
export async function forgetSent(circle: string, prayed: number) {
  const all = (await meta.get<Record<string, number[]>>(SENT)) ?? {}
  if (!all[circle]?.includes(prayed)) return
  await meta.set(SENT, { ...all, [circle]: all[circle].filter(x => x !== prayed) })
}
