import { quoteDocumentText, rangeAtIndexedOffset } from './epub-indexed-range'
import { decodeEpubAnchor, type ReadiumDomRange } from '@shudeng/core/domain'
/** Accept both current CFI anchors and migrated Readium locators without discarding their text. */
export interface EpubTarget {
  cfi?: string
  href?: string
  progression?: number
  quote?: string
  selector?: string
  before?: string
  after?: string
  domRange?: ReadiumDomRange
  textOffset?: { readonly start: number; readonly end: number }
}
/** Native chrome starts with the book title and only replaces it with a nonempty locator title. */
export function epubChapterTitle(bookTitle: string, label?: string, previousTitle?: string): string {
  return label || previousTitle || bookTitle
}

/** Foliate's image-only visible range can end at img/0 without including its box. */
export function paintedEpubAnchor(anchor: Range | Element | number): Range | Element | number {
  if (typeof anchor === 'number' || !('startContainer' in anchor) || anchor.toString().trim()) return anchor
  const replaced = (node: Node | undefined): Element | null => {
    if (node?.nodeType !== 1) return null
    const element = node as Element
    return element.matches('img,svg,video,canvas') ? element : null
  }
  const start = replaced(anchor.startContainer) ?? replaced(anchor.startContainer.childNodes[anchor.startOffset])
  if (start) return start
  const root = anchor.commonAncestorContainer
  const parent = root.nodeType === 1 ? root as Element : root.parentElement
  for (const element of parent?.querySelectorAll('img,svg,video,canvas') ?? []) {
    const bounds = element.ownerDocument.createRange()
    bounds.selectNode(element)
    // Both boundaries must contain the element. Ending at img/0 excludes its box.
    if (anchor.compareBoundaryPoints(0, bounds) <= 0 && anchor.compareBoundaryPoints(2, bounds) >= 0) return element
  }
  // Foliate also encodes a lone visible image as whitespace → img/0. Only use
  // this terminal media after contained media, or a multi-image page skips ahead.
  if (anchor.endOffset === 0) return replaced(anchor.endContainer) ?? anchor
  return anchor
}
/** foliate's public fraction includes the visible page's end; the shelf shows its start. */
export function publicationStartFraction(sections: readonly { size?: number; linear?: string }[], index: number, fraction: number): number {
  const sizes = sections.map(section => section.linear !== 'no' && (section.size ?? 0) > 0 ? section.size ?? 0 : 0)
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (!total || !Number.isFinite(fraction)) return 0
  const before = sizes.slice(0, Math.max(0, index)).reduce((sum, size) => sum + size, 0)
  return Math.max(0, Math.min(1, (before + (sizes[index] ?? 0) * Math.max(0, Math.min(1, fraction))) / total))
}
export function epubTarget(value: string, quote?: string): EpubTarget {
  const location = decodeEpubAnchor(value)
  if (!location) throw new Error('这条记录没有可用的原文位置')
  const selection = location.selection
  const text = selection?.text
  const locations = selection?.locations
  const highlight = text?.highlight ?? quote
  return {
    ...(location.cfi ? { cfi: location.cfi } : {}),
    ...(location.href ? { href: location.href } : {}),
    ...(locations?.progression === undefined ? {} : { progression: locations.progression }),
    ...(highlight ? { quote: highlight } : {}),
    ...(locations?.cssSelector ? { selector: locations.cssSelector } : {}),
    ...(text?.before === undefined ? {} : { before: text.before }),
    ...(text?.after === undefined ? {} : { after: text.after }),
    ...(locations?.domRange ? { domRange: locations.domRange } : {}),
    ...(location.textOffset ? { textOffset: location.textOffset } : {}),
  }
}

export function samePublicationHref(left: string, right: string): boolean {
  const normalize = (href: string) => {
    try { return decodeURIComponent(href.split('#')[0] ?? '').replace(/^\.\//, '').replace(/^\//, '') } catch { return href.split('#')[0] ?? '' }
  }
  const a = normalize(left), b = normalize(right)
  return a === b || a.endsWith('/' + b) || b.endsWith('/' + a)
}

/** Whitespace folding keeps an offset map so selections across inline elements remain exact. */
export function textRangeForQuote(doc: Document, quote: string, context: { selector?: string; before?: string; after?: string; textOffset?: { readonly start: number; readonly end: number } } = {}): Range | null {
  if (context.textOffset) {
    const exact = rangeAtIndexedOffset(doc, context.textOffset.start, context.textOffset.end, quote)
    if (exact) return exact
  }
  const target = quote.replace(/\s+/g, '').trim()
  if (!target) return null
  const root = context.selector ? doc.querySelector(context.selector) : doc.body
  if (!root) return null
  const mapped = quoteDocumentText(doc, root)
  const { text } = mapped
  const before = context.before?.replace(/\s+/g, '')
  const after = context.after?.replace(/\s+/g, '')
  let index = text.indexOf(target)
  const contextMatches = (at: number) => (!before || text.slice(0, at).endsWith(before)) && (!after || text.slice(at + target.length).startsWith(after))
  while (index >= 0 && !contextMatches(index)) index = text.indexOf(target, index + 1)
  if (context.textOffset && index >= 0) {
    let next = text.indexOf(target, index + 1)
    while (next >= 0 && !contextMatches(next)) next = text.indexOf(target, next + 1)
    if (next >= 0) throw new Error('这段原文出现多次，暂时无法确认记录的位置，请重新准备后重试')
  }
  const first = mapped.pointAt(index), last = mapped.pointAt(index + target.length - 1)
  if (index < 0 || !first || !last) return null
  const range = doc.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset + 1)
  return range
}
