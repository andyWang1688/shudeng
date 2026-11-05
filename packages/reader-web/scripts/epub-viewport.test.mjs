import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { boundedViewport, logicalRect } from 'foliate-js/bounded-viewport.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { stabilizeEmptyAnchorBox, stabilizeEmptyTerminalBlock, terminalRecoveryForAnchor, visibleDocumentViewport } from '../src/epub-viewport.ts'
import { readerHarness } from './epub-reader-test-harness.mjs'

const SIZE = 347, HEIGHT = 700

test('a zero-sized terminal anchor gets one viewport-height layout box', () => {
  const style = { minHeight: '' }
  const element = {
    nodeType: 1,
    textContent: 'PARITYGIANTTAIL24MZQJH',
    style,
    getBoundingClientRect: () => ({ left: 10, top: -11910822, width: 0, height: 0, right: 10, bottom: -11910822 }),
  }
  const text = { nodeType: 3, parentElement: element }
  const anchor = { endContainer: text }
  const doc = { defaultView: { innerHeight: 319.2 } }
  assert.equal(stabilizeEmptyAnchorBox(anchor, doc, 280), true)
  assert.equal(style.minHeight, '320px')
})

test('visible, numeric, empty and image anchors are not relaid out', () => {
  let writes = 0
  const styles = () => ({ set minHeight(_) { writes++ }, get minHeight() { return '' } })
  const visible = {
    nodeType: 1,
    textContent: 'visible',
    style: styles(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 30, right: 20, bottom: 30 }),
  }
  const empty = {
    nodeType: 1,
    textContent: '  ',
    style: styles(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  }
  const doc = { defaultView: { innerHeight: 500 } }
  assert.equal(stabilizeEmptyAnchorBox(visible, doc), false)
  assert.equal(stabilizeEmptyAnchorBox(empty, doc), false)
  assert.equal(stabilizeEmptyAnchorBox(7, doc), false)
  assert.equal(stabilizeEmptyAnchorBox({ endContainer: { nodeType: 1 } }, doc), false)
  assert.equal(writes, 0)
})

test('a zero-sized terminal anchor falls back to the reader host height', () => {
  const style = { minHeight: '' }
  const element = {
    nodeType: 1, textContent: 'tail', style,
    getBoundingClientRect: () => ({ left: 0, top: -1, width: 0, height: 0, right: 0, bottom: -1 }),
  }
  assert.equal(stabilizeEmptyAnchorBox({ endContainer: { nodeType: 3, parentElement: element } }, { defaultView: null }, 347), true)
  assert.equal(style.minHeight, '347px')
})

test('the final block is stabilized even when the CFI range ends in a child node', () => {
  const style = { minHeight: '' }
  const terminal = {
    nodeType: 1, textContent: 'tail', style,
    getBoundingClientRect: () => ({ left: 0, top: -100, width: 0, height: 0, right: 0, bottom: -100 }),
  }
  const doc = { body: { lastElementChild: terminal }, defaultView: { innerHeight: 411 } }
  assert.equal(stabilizeEmptyTerminalBlock(doc, 319), true)
  assert.equal(style.minHeight, '411px')
})

test('a zero-sized terminal CFI produces readable context while preserving its exact match', () => {
  const tail = {
    nodeType: 1,
    textContent: 'PARITYGIANTTAIL24MZQJH',
    previousElementSibling: null,
    closest() { return this },
    getBoundingClientRect: () => ({ left: 708, top: -16776717, width: 0, height: 0, right: 708, bottom: -16776717 }),
  }
  const before = {
    nodeType: 1,
    textContent: 'This generated final reading paragraph remains visible and searchable. '.repeat(8),
    previousElementSibling: null,
    closest() { return this },
    getBoundingClientRect: () => ({ left: 708, top: -16776717, width: 0, height: 1, right: 708, bottom: -16776716 }),
  }
  tail.previousElementSibling = before
  const range = {
    endContainer: { nodeType: 3, parentElement: tail },
    toString: () => 'PARITYGIANTTAIL24MZQJH',
  }
  const recovery = terminalRecoveryForAnchor(range, 80)
  assert.ok(recovery)
  assert.equal(recovery.match, 'PARITYGIANTTAIL24MZQJH')
  assert.deepEqual(recovery.blocks.at(-1), { text: 'PARITYGIANTTAIL24MZQJH', target: true })
  assert.equal(recovery.blocks.slice(0, -1).map(block => block.text).join('').length, 58)
  assert.ok(recovery.blocks[0].text.endsWith('searchable.'))
})

test('a painted terminal block and non-text anchor do not use recovery', () => {
  const element = {
    nodeType: 1, textContent: 'visible tail', previousElementSibling: null,
    closest() { return this },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 319, height: 31, right: 329, bottom: 51 }),
  }
  assert.equal(terminalRecoveryForAnchor({ endContainer: { nodeType: 3, parentElement: element }, toString: () => 'visible tail' }), null)
  assert.equal(terminalRecoveryForAnchor(7), null)
  assert.equal(terminalRecoveryForAnchor({ endContainer: { nodeType: 1, parentElement: null } }), null)
})

test('a finite physical window covers every logical visible interval, including both sentinels and fast skips', () => {
  for (const pages of [1, 2, 3, 4, 37, 40000]) {
    const content = pages * SIZE
    for (const position of [0, .25 * SIZE, SIZE, 1.5 * SIZE, 3.99 * SIZE, 21.5 * SIZE, content - 1, content, content + .5 * SIZE, content + SIZE]) {
      const q = Math.max(0, Math.min(content + SIZE, position))
      const window = boundedViewport(SIZE, content, q)
      assert.ok(window.width <= SIZE * 3)
      assert.ok(window.start >= 0 && window.start + window.width <= content)
      const visibleLeft = Math.max(SIZE, q), visibleRight = Math.min(content + SIZE, q + SIZE)
      if (visibleRight > visibleLeft) {
        assert.ok(window.left <= visibleLeft && window.left + window.width >= visibleRight)
        // The full DOM Range retains its logical offset after inner scrolling.
        const logical = (visibleLeft + visibleRight) / 2 - SIZE
        const client = logical - window.start
        assert.equal(logicalRect({ left: client, right: client + 10 }, window.start).left, logical)
        assert.equal(window.left - q + client, SIZE - q + logical)
      }
    }
  }
})

class Element {
  style = { setProperty(key, value) { this[key] = value } }
  children = []
  events = new Map()
  attributes = new Map()
  classList = { toggle() {} }
  scrollLeft = 0
  scrollTop = 0
  constructor(name = 'div') { this.localName = name; this.nodeType = 1 }
  setAttribute(name, value) { const old = this.getAttribute(name); this.attributes.set(name, value); this.attributeChangedCallback?.(name, old, value) }
  removeAttribute(name) { const old = this.getAttribute(name); this.attributes.delete(name); this.attributeChangedCallback?.(name, old, null) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  append(...items) { for (const item of items) { this.children.push(item); item.parentNode = this } }
  appendChild(item) { this.append(item) }
  removeChild(item) { this.children.splice(this.children.indexOf(item), 1) }
  replaceChildren(...items) { this.children = []; this.append(...items) }
  addEventListener(name, callback) { const list = this.events.get(name) ?? []; list.push(callback); this.events.set(name, list) }
  dispatchEvent(event) { for (const listener of this.events.get(event.type) ?? []) listener(event); return true }
  querySelectorAll() { return [] }
  getBoundingClientRect() {
    const width = this.style.width?.endsWith('%') ? SIZE : Number.parseFloat(this.style.width) || SIZE
    const left = this.localName === 'iframe' ? (Number.parseFloat(this.style.left) || SIZE) - (this.parentNode?.parentNode?.scrollLeft ?? 0) : 0
    return { left, right: left + width, top: 0, bottom: HEIGHT, width, height: HEIGHT }
  }
  attachShadow() {
    const elements = new Map(['top', 'background', 'container', 'header', 'footer'].map(id => [id, new Element()]))
    this.shadowElements = elements
    return { set innerHTML(_) {}, getElementById: id => elements.get(id) }
  }
}

function fakeDOM({ vertical = false, rtl = false, pages = 37, trailingClamp = 0, programmaticScrollEvents = false } = {}) {
  let currentDoc, frame, spread = SIZE
  const queuedScrollEvents = []
  const rect = (doc, left = 0, width = pages * spread) => ({ left: left - (doc?.defaultView.scrollX ?? 0), right: left + width - (doc?.defaultView.scrollX ?? 0), top: 0, bottom: HEIGHT, width, height: HEIGHT })
  const range = () => ({
    startContainer: null, logicalLeft: 0,
    selectNodeContents(node) { this.startContainer = node; this.commonAncestorContainer = node },
    getBoundingClientRect() { return rect(this.startContainer?.ownerDocument) },
    getClientRects() { return [rect(this.startContainer?.ownerDocument, this.logicalLeft, 12)] },
    cloneRange() { return { ...this } }, collapse() {},
    setStart(node) { this.startContainer = node }, setEnd() {},
    toString() { return 'same full DOM text' },
  })
  const selection = { removeAllRanges() {}, addRange() {}, rangeCount: 0, isCollapsed: true }
  const style = { writingMode: vertical ? 'vertical-rl' : 'horizontal-tb', direction: rtl ? 'rtl' : 'ltr', backgroundColor: '#fff', backgroundImage: 'none', background: '#fff', getPropertyValue(key) { return { '--_max-inline-size': '720px', '--_max-column-count-spread': '1', '--_margin': '28px', '--_gap': '8%' }[key] ?? '' } }
  const root = {
    createRange: range,
    createElement(name) {
      const el = new Element(name)
      if (name === 'iframe') {
        frame = el
        const doc = new Element('document')
        doc.body = new Element('body'); doc.documentElement = new Element('html')
        doc.body.ownerDocument = doc
        doc.documentElement.getBoundingClientRect = () => rect(doc, 0, spread)
        const listeners = new Map()
        let scrollCalls = 0
        doc.defaultView = {
          scrollX: 0, get innerWidth() { return Number.parseFloat(el.style.width) || SIZE }, innerHeight: HEIGHT,
          get frameElement() { return el }, getComputedStyle: () => style,
          addEventListener(name, callback) { listeners.set(name, callback) },
          scrollTo(x) {
            scrollCalls += 1
            const previous = this.scrollX
            this.scrollX = Math.max(0, Math.min(pages * spread - trailingClamp - this.innerWidth, x))
            if (programmaticScrollEvents && previous !== this.scrollX) queuedScrollEvents.push(() => listeners.get('scroll')?.())
          },
          getSelection: () => selection,
        }
        doc.emitInternalScroll = x => { doc.defaultView.scrollX = x; listeners.get('scroll')?.() }
        doc.scrollCalls = () => scrollCalls
        doc.getSelection = () => selection; doc.hasFocus = () => false
        doc.createRange = range; doc.fonts = { ready: new Promise(() => {}) }
        el.contentDocument = doc; currentDoc = doc
        Object.defineProperty(el, 'src', { set() { queueMicrotask(() => el.dispatchEvent({ type: 'load' })) } })
      }
      return el
    },
    createElementNS: (_, name) => new Element(name),
  }
  globalThis.document = root
  globalThis.HTMLElement = Element
  globalThis.ResizeObserver = class { observe() {} unobserve() {} }
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 }
  globalThis.getComputedStyle = () => style
  globalThis.matchMedia = () => ({ addEventListener() {}, removeEventListener() {} })
  globalThis.customElements = { define() {} }
  globalThis.requestAnimationFrame = () => 0
  globalThis.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail } }
  let source = readFileSync(new URL('../node_modules/foliate-js/paginator.js', import.meta.url), 'utf8')
  source = source.replace(/^import .*\n/, '').replace('export class Paginator', 'class Paginator').replace('const getVisibleRange =', 'let getVisibleRange =')
  const loaded = new Function('boundedViewport', 'logicalRect', source + '\nreturn { Paginator, View, installVisibleRange: fn => { getVisibleRange = fn } }')(boundedViewport, logicalRect)
  const mapped = []
  loaded.installVisibleRange((doc, start, end, mapper) => {
    const target = range(); target.selectNodeContents(doc.body); target.logicalLeft = Math.max(0, start)
    const client = target.getClientRects()[0]
    mapped.push({ start, end, logicalLeft: mapper(client).left })
    return target
  })
  return { ...loaded, mapped, setPages: value => { pages = value }, setSpread: value => { spread = value }, flushScrollEvents() {
    let remaining = 32
    while (queuedScrollEvents.length) {
      if (--remaining === 0) throw new Error('Recursive inner scroll events')
      queuedScrollEvents.shift()()
    }
  }, get doc() { return currentDoc }, get frame() { return frame } }
}

test('production Paginator preserves logical page/Range coordinates and external Overlayer drawing/hits across window shifts', async () => {
  const dom = fakeDOM()
  const paginator = new dom.Paginator()
  paginator.setAttribute('bounded-horizontal-viewport', '')
  paginator.open({ sections: [{ load: async () => 'chapter.xhtml' }] })
  let overlay
  paginator.addEventListener('create-overlayer', ({ detail }) => {
    overlay = new Overlayer(detail.doc)
    detail.attach(overlay)
  })
  await paginator.goTo({ index: 0, anchor: 0 })
  assert.equal(paginator.pages, 39, '37 text spreads plus two sentinels')
  assert.equal(dom.doc.documentElement.style.width, SIZE + 'px', 'root keeps one-spread column geometry')
  assert.equal(paginator.page, 1)
  const range = dom.doc.createRange(); range.selectNodeContents(dom.doc.body)
  for (const page of [1, 2, 19, 37, 12, 1]) {
    paginator.containerPosition = page * SIZE
    await paginator.scrollToAnchor((page - 1) / 36)
    const state = paginator.getViewportState()
    assert.equal(state.position, page * SIZE)
    assert.equal(state.pages, 39)
    assert.equal(state.scrollX, state.windowStart)
    assert.equal(state.iframeWidth, 3 * SIZE)
    assert.equal(dom.mapped.at(-1).logicalLeft, (page - 1) * SIZE)
    if (overlay.element.children.length) {
      const currentClient = range.getClientRects()[0].left
      assert.equal(overlay.element.children[0].rects[0].left, currentClient, 'existing annotation redraws when its carrier window moves')
      assert.equal(overlay.hitTest({ x: currentClient + 2, y: 2 })[0], 'note')
    }
    range.logicalLeft = (page - 1) * SIZE + 20
    overlay.add('note', range, rects => ({ rects }))
    const clientX = range.getClientRects()[0].left + 2
    assert.equal(overlay.hitTest({ x: clientX, y: 2 })[0], 'note')
    assert.equal(Number.parseFloat(overlay.element.style.left), state.iframeLeft)
    assert.equal(overlay.element.style.overflow, 'hidden')
    const frame = dom.frame.getBoundingClientRect()
    assert.equal(frame.left + clientX, 22, 'selection and annotation screen coordinates')
  }
  paginator.containerPosition = 38 * SIZE
  assert.equal(paginator.page, 38)
  assert.equal(paginator.pages, 39, 'tail sentinel does not become a text page')
  paginator.containerPosition = 10 * SIZE
  const before = paginator.getViewportState()
  dom.doc.emitInternalScroll(before.scrollX + 17)
  assert.equal(paginator.containerPosition, 10 * SIZE + 17, 'native focus scrolling updates the logical position')
  paginator.removeAttribute('bounded-horizontal-viewport')
  assert.equal(paginator.getViewportState(), null)
  assert.equal(dom.doc.defaultView.scrollX, 0)
  assert.equal(paginator.pages, 39, 'legacy/curl restoration retains logical page count')
})

test('a browser-clamped trailing scroll retains Range screen coordinates and the logical tail page', async () => {
  const dom = fakeDOM({ trailingClamp: 13 })
  const paginator = new dom.Paginator()
  paginator.setAttribute('bounded-horizontal-viewport', '')
  paginator.open({ sections: [{ load: async () => 'chapter.xhtml' }] })
  await paginator.goTo({ index: 0, anchor: 1 })
  const state = paginator.getViewportState()
  assert.equal(paginator.page, 37)
  assert.equal(state.requestedStart - state.scrollX, 13)
  assert.equal(state.windowStart, state.scrollX)
  assert.equal(state.iframeLeft, SIZE + state.scrollX)
  assert.equal(dom.mapped.at(-1).logicalLeft, 36 * SIZE)
})

test('positive, negative, and zero subpixel inner scrolls preserve carrier coordinates without recursive callbacks', async () => {
  for (const delta of [.1, .4, .5, .6, -.1, -.4, -.5, -.6, 0]) {
    const dom = fakeDOM({ programmaticScrollEvents: true }), paginator = new dom.Paginator()
    paginator.setAttribute('bounded-horizontal-viewport', '')
    paginator.open({ sections: [{ load: async () => 'chapter.xhtml' }] })
    await paginator.goTo({ index: 0, anchor: 0 })
    paginator.containerPosition = 10 * SIZE
    dom.flushScrollEvents()
    const before = paginator.getViewportState(), calls = dom.doc.scrollCalls()
    dom.doc.emitInternalScroll(before.scrollX + delta)
    dom.flushScrollEvents()
    const after = paginator.getViewportState()
    assert.ok(Math.abs(after.position - (before.position + delta)) < 1e-9, 'logical delta ' + delta)
    assert.equal(after.iframeLeft, after.spreadSize + after.scrollX, 'carrier delta ' + delta)
    assert.equal(after.windowStart, after.scrollX)
    const settledCalls = dom.doc.scrollCalls()
    assert.equal(settledCalls - calls, delta === 0 ? 0 : 1)
    dom.doc.emitInternalScroll(after.scrollX)
    dom.flushScrollEvents()
    assert.equal(dom.doc.scrollCalls(), settledCalls, 'zero callback must not resynchronize')
  }
})

test('font and viewport reflow retain the same DOM Range anchor while recomputing logical pages and finite geometry', async () => {
  const dom = fakeDOM(), paginator = new dom.Paginator()
  paginator.setAttribute('bounded-horizontal-viewport', '')
  paginator.open({ sections: [{ load: async () => 'chapter.xhtml' }] })
  await paginator.goTo({ index: 0, anchor: .5 })
  const range = dom.doc.createRange(); range.selectNodeContents(dom.doc.body)
  range.logicalLeft = 18 * SIZE
  await paginator.scrollToAnchor(range)
  const sameDocument = dom.doc, sameNode = range.startContainer
  // Model a font reflow moving this exact text anchor to a later column.
  dom.setPages(55); range.logicalLeft = 20 * SIZE
  paginator.render()
  assert.equal(paginator.pages, 57)
  assert.equal(paginator.page, 21)
  // Model a viewport width change without rebuilding the document or anchor.
  const resized = 321
  dom.setSpread(resized)
  paginator.shadowElements.get('container').style.width = resized + 'px'
  range.logicalLeft = 20 * resized
  paginator.render()
  assert.equal(paginator.page, 21)
  assert.equal(paginator.pages, 57)
  assert.equal(dom.doc, sameDocument)
  assert.equal(range.startContainer, sameNode)
  assert.equal(dom.doc.documentElement.style.width, resized + 'px')
  assert.equal(paginator.getViewportState().iframeWidth, 3 * resized)
  assert.equal(dom.mapped.at(-1).logicalLeft, 20 * resized)
})

test('vertical, RTL, scrolled, and default builds preserve the legacy carrier', async () => {
  for (const options of [{ vertical: true }, { rtl: true }, { flow: 'scrolled' }, { enabled: false }]) {
    const dom = fakeDOM(options), view = new dom.View({ container: { start: SIZE }, onExpand() {} })
    await view.load('chapter.xhtml', undefined, () => ({ flow: options.flow, boundedViewport: options.enabled !== false, width: SIZE, height: HEIGHT, margin: 28, gap: 28, columnWidth: SIZE - 28 }))
    assert.equal(view.bounded, false)
    assert.equal(view.viewportState(), null)
  }
})

test('default-off production pagination keeps the original full-chapter iframe and page coordinates', async () => {
  const dom = fakeDOM(), paginator = new dom.Paginator()
  paginator.open({ sections: [{ load: async () => 'chapter.xhtml' }] })
  await paginator.goTo({ index: 0, anchor: .5 })
  assert.equal(paginator.getViewportState(), null)
  assert.equal(paginator.pages, 39)
  assert.equal(paginator.page, 19)
  assert.equal(dom.frame.style.width, 37 * SIZE + 'px')
  assert.equal(dom.frame.style.position, '')
  assert.equal(dom.doc.documentElement.style.width, SIZE + 'px')
  assert.equal(dom.doc.defaultView.scrollX, 0)
  assert.equal(dom.mapped.at(-1).logicalLeft, 18 * SIZE)
  await paginator.goTo({ index: 0, anchor: 1 })
  assert.equal(paginator.page, 37)
  assert.equal(paginator.pages, 39)
  assert.equal(dom.frame.style.width, 37 * SIZE + 'px')
  assert.equal(dom.doc.defaultView.scrollX, 0)
})

test('leaving an active finite carrier for scrolled mode restores the legacy overlay clipping style', async () => {
  const dom = fakeDOM(), paginator = new dom.Paginator()
  let overlay
  paginator.setAttribute('bounded-horizontal-viewport', '')
  paginator.open({ sections: [{ load: async () => 'chapter.xhtml' }] })
  paginator.addEventListener('create-overlayer', ({ detail }) => {
    overlay = new Overlayer(detail.doc)
    detail.attach(overlay)
  })
  await paginator.goTo({ index: 0, anchor: 0 })
  paginator.containerPosition = 10 * SIZE
  assert.equal(overlay.element.style.overflow, 'hidden')
  paginator.setAttribute('flow', 'scrolled')
  assert.equal(paginator.getViewportState(), null)
  assert.equal(overlay.element.style.overflow, '')
  assert.equal(dom.frame.style.position, '')
  assert.equal(dom.doc.defaultView.scrollX, 0)
})

test('visible bookmarks use the host-clipped iframe viewport', () => {
  const host = { getBoundingClientRect: () => ({ left: 14, right: 361, top: 28, bottom: 728 }) }
  const doc = { defaultView: { innerWidth: 3 * SIZE, innerHeight: HEIGHT, frameElement: { getBoundingClientRect: () => ({ left: 14 - SIZE, top: 28 }) } } }
  assert.deepEqual(visibleDocumentViewport(doc, host), { left: SIZE, right: 2 * SIZE, top: 0, bottom: HEIGHT })
})

test('actual reader pointer handlers use visible tap zones for both finite and full-chapter carriers', async () => {
  for (const bounded of [false, true]) {
    const { reader, renderer, host } = readerHarness({ boundedViewport: bounded })
    await reader.open('book.epub', 'Book')
    renderer.getViewportState = () => bounded ? { mode: 'bounded-horizontal' } : null
    host.getBoundingClientRect = () => ({ left: 14, right: 361, top: 28, bottom: 728 })
    const listeners = new Map()
    const doc = {
      defaultView: { innerWidth: 3 * SIZE, innerHeight: HEIGHT, frameElement: { getBoundingClientRect: () => ({ left: 14 - SIZE, top: 28 }) } },
      getSelection: () => ({ toString: () => '' }),
      addEventListener(name, callback) { const list = listeners.get(name) ?? []; list.push(callback); listeners.set(name, list) },
    }
    reader.attachSelection(doc, 0)
    let previous = 0, next = 0
    reader.prev = async () => { previous += 1 }; reader.next = async () => { next += 1 }
    for (const x of [1.1 * SIZE, 1.5 * SIZE, 1.9 * SIZE]) {
      for (const type of ['pointerdown', 'pointerup']) for (const callback of listeners.get(type)) callback({ clientX: x, clientY: 20 })
    }
    assert.equal(previous, 1)
    assert.equal(next, 1)
  }
})

test('real reader hooks disable the carrier throughout curl preparation and restore on success, cancellation, abort, or failed begin', async () => {
  const { reader, renderer, log } = readerHarness({ boundedViewport: true })
  await reader.open('book.epub', 'Book')
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), '')
  reader.setNativeCurl(true)
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), null)
  reader.setNativeCurl(false)
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), '')
  const page = { cfi: 'epubcfi(/6/2!/4/2/1:0)', key: '0:9:39', signature: 'same text' }
  reader.nativePage = async () => page
  await reader.beginNativePreparation()
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), null)
  await reader.finishNativePreparation(true)
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), '')
  await reader.beginNativePreparation()
  await reader.finishNativePreparation(false)
  assert.ok(log.some(item => item[0] === 'goTo'), 'cancel calls the original CFI restore path')
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), '')
  await reader.beginNativePreparation()
  reader.waitForPaint = async () => {}
  await reader.abortNativePreparation()
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), '')
  reader.nativePage = async () => { throw new Error('paint failed') }
  await assert.rejects(reader.beginNativePreparation(), /paint failed/)
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), '')
  await reader.setFlow('scrolled')
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), null)
})

for (const where of ['goTo', 'waitForPaint']) test('failed native abort retains its explicit target and retries recovery before a new preparation: ' + where, async () => {
  const published = []
  const { reader, renderer, emitRelocate } = readerHarness({ boundedViewport: true, onProgress: progress => published.push(progress) })
  await reader.open('book.epub', 'Book')
  const original = { cfi: 'epubcfi(/6/2!/4/2/1:0)', key: '0:9:39', signature: 'original', progress: reader.lastProgress, fraction: 0, canPrevious: true, canNext: true }
  const retained = { ...original, cfi: 'epubcfi(/6/2!/4/2/1:90)', key: '0:10:39', signature: 'retained explicit target' }
  const temporary = { cfi: 'epubcfi(/6/2!/4/2/1:120)', fraction: .5, section: { current: 0 } }
  reader.nativePage = async () => original
  await reader.beginNativePreparation()
  const failure = new Error(where === 'goTo' ? 'restore navigation failed' : 'paint deadline')
  let failing = true
  const restored = []
  reader.goTo = async cfi => {
    restored.push(cfi)
    if (failing && where === 'goTo') throw failure
    emitRelocate({ cfi, fraction: .2, section: { current: 0 } })
  }
  reader.waitForPaint = async () => { if (failing && where === 'waitForPaint') throw failure }
  await assert.rejects(reader.abortNativePreparation(retained), error => error === failure)
  reader.setNativeCurl(false)
  assert.equal(reader.nativePreparing, false)
  assert.equal(reader.nativeRecoveryPending, true)
  assert.equal(reader.nativeOriginal, retained, 'explicit recovery target survives navigation or paint failure')
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), null)
  const publicationCount = published.length
  emitRelocate(temporary)
  await assert.rejects(reader.nativeStep(1), /原文尚未恢复/)
  await assert.rejects(reader.finishNativePreparation(true), /原文尚未恢复/)
  await assert.rejects(reader.finishNativePreparation(false), /原文尚未恢复/)
  assert.equal(published.length, publicationCount, 'temporary page cannot be persisted')
  await assert.rejects(reader.beginNativePreparation(), error => error === failure)
  assert.equal(reader.nativePreparing, false)
  assert.equal(reader.nativeRecoveryPending, true)
  assert.equal(reader.nativeOriginal, retained)
  failing = false
  reader.nativePage = async () => retained
  const recovered = await reader.beginNativePreparation()
  assert.equal(restored.at(-1), retained.cfi)
  assert.equal(recovered, retained)
  assert.equal(reader.nativeRecoveryPending, false)
  assert.equal(reader.nativePreparing, true, 'a new transaction begins only after restoration succeeds')
  await reader.finishNativePreparation(false)
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), '')
  assert.equal(reader.nativeOriginal, null)
  assert.ok(published.every(progress => progress.locator.cfi !== temporary.cfi))
})

test('default-off abort failure retains the original legacy failure path', async () => {
  const { reader, renderer } = readerHarness()
  await reader.open('book.epub', 'Book')
  const original = { cfi: 'epubcfi(/6/2!/4/2/1:0)', key: '0:9:39', signature: 'original' }
  reader.nativePage = async () => original
  await reader.beginNativePreparation()
  const failure = new Error('legacy navigation failure')
  reader.goTo = async () => { throw failure }
  await assert.rejects(reader.abortNativePreparation(), error => error === failure)
  assert.equal(reader.nativeOriginal, original)
  assert.equal(reader.nativePreparing, false)
  assert.equal(reader.nativeRecoveryPending, false)
  assert.equal(renderer.getAttribute('bounded-horizontal-viewport'), null)
  await assert.rejects(reader.beginNativePreparation(), /尚未结束/)
})
