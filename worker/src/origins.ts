/** Is this calling address one the sync service answers? It is when ORIGINS
 *  lists it, or lists https://*.<domain> and the address is one name under
 *  that domain. Only the test sync service lists one like that: the test
 *  site gives each pull request its own address (pr-12.<domain>). */
export function originAllowed(list: string[], origin: string): boolean {
  if (list.includes(origin)) return true
  const m = /^https:\/\/[a-z0-9-]+\.(.+)$/.exec(origin)
  return !!m && list.includes(`https://*.${m[1]}`)
}
