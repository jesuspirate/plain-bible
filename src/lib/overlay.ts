// Anything laid over the word: a sheet (<dialog>), the Settings sheet, the
// prayer screen with Circles, the open search panel, a card asking
// something (role="dialog"). While one is up, a swipe, a trackpad swipe or
// an arrow key is meant for it, never for turning the chapter behind it.
// New sheets are covered as long as they are a <dialog> or say role="dialog".
export const OVERLAY = 'dialog[open], [role="dialog"], [aria-modal="true"], .sb-open'

export function overlayOpen(root: Pick<ParentNode, 'querySelector'> | undefined = globalThis.document): boolean {
  return !!root?.querySelector(OVERLAY)
}
