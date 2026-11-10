export interface EpubViewport { left: number; right: number; top: number; bottom: number }

/** Range rects stay in iframe viewport coordinates, including its inner scroll. */
export function visibleDocumentViewport(doc: Document, host: HTMLElement): EpubViewport | undefined {
  const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
  if (!frame) return undefined
  const bounds = host.getBoundingClientRect()
  return {
    left: Math.max(0, bounds.left - frame.left),
    right: Math.min(doc.defaultView?.innerWidth ?? 0, bounds.right - frame.left),
    top: Math.max(0, bounds.top - frame.top),
    bottom: Math.min(doc.defaultView?.innerHeight ?? 0, bounds.bottom - frame.top),
  }
}

type AnchorLike = Range | Element | number
const terminalLayout = new WeakMap<Document, Map<HTMLElement, { previous: string; assigned: string }>>()

function setTerminalHeight(element: HTMLElement, doc: Document, height: number): void {
  let changes = terminalLayout.get(doc)
  if (!changes) { changes = new Map(); terminalLayout.set(doc, changes) }
  const assigned = `${Math.ceil(height)}px`
  const change = changes.get(element)
  const previous = change && element.style.minHeight === change.assigned ? change.previous : element.style.minHeight ?? ''
  changes.set(element, { previous, assigned })
  element.style.minHeight = assigned
}

export function restoreTerminalLayout(doc: Document): void {
  for (const [element, change] of terminalLayout.get(doc) ?? []) {
    if (element.style.minHeight === change.assigned) element.style.minHeight = change.previous
  }
  terminalLayout.delete(doc)
}

function anchorElement(anchor: Exclude<AnchorLike, number>): Element | null {
  const endpoint = 'endContainer' in anchor ? anchor.endContainer : anchor
  if (endpoint.nodeType === 1) return endpoint as Element
  return endpoint.parentElement
}

export interface TerminalRecoveryBlock {
  readonly text: string
  readonly target: boolean
}

export interface TerminalRecovery {
  readonly blocks: readonly TerminalRecoveryBlock[]
  readonly match: string
}

const normalizeText = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? ''

/**
 * WebKit can give the final paragraph after an exactly full column a 0×0 box.
 * The locator and paginator still report success, but the destination paints
 * offscreen. Giving only that empty terminal block a viewport-height box makes
 * WebKit allocate the missing column; the DOM range and CFI stay unchanged.
 */
export function stabilizeEmptyAnchorBox(anchor: AnchorLike, doc: Document, fallbackHeight = 0): boolean {
  if (typeof anchor === 'number') return false
  const element = anchorElement(anchor)
  if (!element || !element.textContent?.trim()) return false
  const box = element.getBoundingClientRect()
  if (box.width > 0 || box.height > 0) return false
  const height = doc.defaultView?.innerHeight || fallbackHeight
  if (!height || height <= 0) return false
  const styled = element as Element & { style?: CSSStyleDeclaration }
  if (!styled.style) return false
  setTerminalHeight(styled as HTMLElement, doc, height)
  return true
}

/** WebKit can lose the final sibling's box after the last full column. */
export function stabilizeEmptyTerminalBlock(doc: Document, fallbackHeight = 0): boolean {
  const element = doc.body?.lastElementChild
  if (!element || !element.textContent?.trim()) return false
  const box = element.getBoundingClientRect()
  if (box.width > 0 || box.height > 0) return false
  const height = doc.defaultView?.innerHeight || fallbackHeight
  if (!height || height <= 0) return false
  const styled = element as Element & { style?: CSSStyleDeclaration }
  if (!styled.style) return false
  setTerminalHeight(styled as HTMLElement, doc, height)
  return true
}

/**
 * Very large single-spine books can exceed WebKit's column-layout range. The
 * exact CFI still resolves, but the final block has no painted box at all;
 * `min-height` cannot recover that pathological node on iOS. Preserve the real
 * locator and render a small, text-only terminal page above the blank carrier.
 */
export function terminalRecoveryForAnchor(anchor: AnchorLike, maxCharacters = 260): TerminalRecovery | null {
  if (typeof anchor === 'number') return null
  const element = anchorElement(anchor)
  if (!element || !normalizeText(element.textContent)) return null
  const box = element.getBoundingClientRect()
  if (box.width > 0 || box.height > 0) return null

  const block = element.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, div')
  const target = block ?? element
  const match = normalizeText('toString' in anchor ? anchor.toString() : target.textContent)
  const blocks: TerminalRecoveryBlock[] = []
  let remaining = Math.max(1, Math.floor(maxCharacters))
  let current: Element | null = target

  while (current && remaining > 0) {
    const text = normalizeText(current.textContent)
    if (!text) {
      current = current.previousElementSibling
      continue
    }
    if (current === target) {
      const matchAt = match ? text.indexOf(match) : -1
      const start = text.length > remaining
        ? matchAt >= 0
          ? Math.max(0, Math.min(matchAt + match.length - remaining, text.length - remaining))
          : text.length - remaining
        : 0
      const shown = text.slice(start, start + remaining)
      blocks.unshift({ text: shown, target: true })
      remaining -= shown.length
    } else {
      const shown = text.slice(Math.max(0, text.length - remaining))
      blocks.unshift({ text: shown, target: false })
      remaining -= shown.length
    }
    current = current.previousElementSibling
  }

  return blocks.length ? { blocks, match } : null
}

