import type { ReadiumDomPosition, ReadiumDomRange, ReadiumLocator } from '@shudeng/core/domain';

export function epubCssSelector(element: Element | null): string {
  const path: string[] = [];
  for (let current = element; current; current = current.parentElement) {
    if (current.id) { path.unshift('#' + CSS.escape(current.id)); break; }
    let index = 1;
    for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.localName === current.localName) index++;
    path.unshift(current.localName + ':nth-of-type(' + index + ')');
  }
  return path.join(' > ');
}
function point(node: Node, offset: number): ReadiumDomPosition {
  if (node.nodeType === Node.TEXT_NODE && node.parentElement) return { cssSelector: epubCssSelector(node.parentElement), textNodeIndex: Array.from(node.parentElement.childNodes).indexOf(node as ChildNode), charOffset: offset };
  return { cssSelector: epubCssSelector(node as Element), textNodeIndex: offset };
}

/** Match the original iOS identity contract without folding text or DOM offsets. */
export function readiumSelection(href: string, doc: Document, range: Range): ReadiumLocator {
  const ancestor = range.commonAncestorContainer;
  const root = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;
  if (!root) throw new Error('无法确定选文位置');
  const before = doc.createRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  const after = doc.createRange(); after.selectNodeContents(root); after.setStart(range.endContainer, range.endOffset);
  return { href, type: 'application/xhtml+xml', locations: { cssSelector: epubCssSelector(root as Element), domRange: { start: point(range.startContainer, range.startOffset), end: point(range.endContainer, range.endOffset) } }, text: { highlight: range.toString(), before: before.toString(), after: after.toString() } };
}

/** Resolve both text-node and element-node points, including ranges across inline tags. */
export function rangeFromReadium(doc: Document, domRange: ReadiumDomRange | undefined): Range | null {
  if (!domRange?.start || !domRange.end) return null;
  const resolve = (position: ReadiumDomPosition): { node: Node; offset: number } | null => {
    if (!position.cssSelector || !Number.isInteger(position.textNodeIndex)) return null;
    const element = doc.querySelector(position.cssSelector);
    if (!element) return null;
    if (position.charOffset === undefined) return { node: element, offset: position.textNodeIndex ?? 0 };
    const node = element.childNodes[position.textNodeIndex ?? -1];
    return node?.nodeType === Node.TEXT_NODE ? { node, offset: position.charOffset } : null;
  };
  try {
    const start = resolve(domRange.start), end = resolve(domRange.end);
    if (!start || !end) return null;
    const range = doc.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    return range.collapsed ? null : range;
  } catch { return null; }
}
