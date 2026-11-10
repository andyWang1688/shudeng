import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { readerHarness } from './epub-reader-test-harness.mjs'
import { mappingDocument } from './epub-test-dom.mjs'

const PREVIOUS_CFI = 'epubcfi(/6/2!/4/2/1:0)'
const CURRENT_CFI = 'epubcfi(/6/4!/4/2/1:0)'
const previousText = 'Previous chapter must remain outside the reader viewport. '.repeat(3)
const currentText = 'Current chapter is the original passage the reader can see. '.repeat(3)
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

// One real parsed paragraph per iframe. The small Range adapter supplies only
// selection/bookmark geometry; this is not a browser-layout or Foliate CFI test.
function publicationDocument(text, frameTop) {
  const doc = mappingDocument('<p id="passage">' + text + '</p>')
  const querySelector = doc.querySelector.bind(doc)
  doc.querySelector = selector => selector.startsWith('[') && selector.endsWith(']')
    ? Array.from(doc.getElementsByTagName('*')).find(element => element.hasAttribute(selector.slice(1, -1))) ?? null
    : querySelector(selector)
  const paragraph = doc.body.firstChild
  paragraph.id = 'passage'
  const node = paragraph.firstChild
  const listeners = new Map()
  let selected = null
  const selection = {
    get isCollapsed() { return selected === null },
    get rangeCount() { return selected ? 1 : 0 },
    get type() { return selected ? 'Range' : 'None' },
    toString: () => selected?.toString() ?? '',
    getRangeAt: () => selected,
    removeAllRanges() { selected = null },
    addRange(range) { selected = range },
  }
  doc.createRange = () => ({
    startContainer: node, endContainer: node, startOffset: 0, endOffset: text.length,
    get commonAncestorContainer() { return node },
    get collapsed() { return this.startOffset === this.endOffset },
    selectNodeContents() { this.startOffset = 0; this.endOffset = text.length },
    setStart(_node, offset) { this.startOffset = offset },
    setEnd(_node, offset) { this.endOffset = offset },
    toString() { return text.slice(this.startOffset, this.endOffset) },
    getBoundingClientRect() { return box(28 + this.startOffset * 4, 20, (this.endOffset - this.startOffset) * 4, 20) },
    getClientRects() { return [this.getBoundingClientRect()] },
  })
  doc.defaultView = {
    innerWidth: 375, innerHeight: 600,
    frameElement: { getBoundingClientRect: () => box(0, frameTop, 375, 600) },
    requestAnimationFrame: callback => { queueMicrotask(callback); return 1 },
  }
  doc.fonts = { ready: Promise.resolve() }
  doc.images = []
  doc.getSelection = () => selection
  doc.querySelectorAll = () => []
  doc.addEventListener = (name, callback) => listeners.set(name, [...(listeners.get(name) ?? []), callback])
  doc.dispatchEvent = event => { for (const callback of listeners.get(event.type) ?? []) callback(event) }
  return doc
}

async function fixture(flow = 'scrolled') {
  const globals = new Map(['document', 'ResizeObserver', 'requestAnimationFrame', 'Node', 'NodeFilter', 'CSS', 'window'].map(key => [key, globalThis[key]]))
  const timers = new Set()
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 }
  globalThis.NodeFilter = { SHOW_TEXT: 4 }
  globalThis.CSS = { escape: value => value }
  globalThis.requestAnimationFrame = callback => { queueMicrotask(callback); return 1 }
  globalThis.window = {
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timers.add(timer); return timer },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer) },
  }
  const messages = []
  const progresses = []
  const harness = readerHarness({ onMessage: message => messages.push(message), onProgress: progress => progresses.push(progress) })
  await harness.reader.open('book.epub', 'Book', { flow })
  const previous = publicationDocument(previousText, -700)
  const current = publicationDocument(currentText, 0)
  const contents = [previous, current].map((doc, index) => ({
    doc, index, overlayer: { remove() {}, add() {}, hitTest: () => [] },
  }))
  const hostBox = () => box(0, 0, 375, 600)
  harness.host.getBoundingClientRect = hostBox
  harness.renderer.getBoundingClientRect = hostBox
  harness.renderer.getContents = () => contents
  harness.renderer.page = 4
  harness.renderer.pages = 30
  harness.reader.element.book.sections = [
    { id: 'previous.xhtml', href: 'previous.xhtml', size: 100, createDocument: async () => previous },
    { id: 'current.xhtml', href: 'current.xhtml', size: 100, createDocument: async () => current },
  ]
  harness.reader.element.resolveCFI = cfi => ({ index: cfi === CURRENT_CFI ? 1 : 0, anchor: doc => doc.createRange() })
  harness.reader.element.getCFI = index => index === 1 ? CURRENT_CFI : PREVIOUS_CFI
  harness.emitLoad(previous, 0)
  harness.emitLoad(current, 1)
  harness.emitRelocate({ cfi: CURRENT_CFI, fraction: .5, section: { current: 1 }, tocItem: { label: 'Current chapter' }, range: current.createRange() })
  return {
    ...harness, previous, current, messages, progresses,
    restore() {
      harness.reader.destroy()
      for (const timer of timers) clearTimeout(timer)
      for (const [key, value] of globals) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
    },
  }
}

test('native page identity follows the visible CFI when a previous chapter remains preloaded', async () => {
  const state = await fixture()
  try {
    const page = await state.reader.nativePage()
    assert.equal(page.cfi, CURRENT_CFI)
    assert.equal(page.signature, currentText.replace(/\s+/g, ' ').trim().slice(0, 180))
    assert.equal(page.progress.locator.href, 'current.xhtml')
  } finally { state.restore() }
})

test('reference arrival waits for the visible chapter font but not an offscreen preloaded font', async () => {
  const state = await fixture()
  const visibleFont = deferred(), offscreenFont = deferred()
  state.current.fonts.ready = visibleFont.promise
  state.previous.fonts.ready = offscreenFont.promise
  let receipt
  const navigation = state.reader.navigateReference({ operationId: 'visible-reference', locator: CURRENT_CFI, citation: null }).then(result => { receipt = result; return result })
  try {
    await nextTurn()
    assert.equal(receipt, undefined, 'an unpainted visible chapter cannot report arrived')
    visibleFont.resolve()
    await nextTurn()
    assert.equal(receipt?.status, 'arrived', 'loading an offscreen chapter must not block an already painted reference')
    assert.equal(receipt.operationId, 'visible-reference')
    assert.equal(receipt.progress.locator.cfi, CURRENT_CFI)
    assert.equal(receipt.progress.locator.href, 'current.xhtml')
  } finally {
    visibleFont.resolve(); offscreenFont.resolve()
    await navigation
    state.restore()
  }
})

test('automatic text selection chooses the visible chapter and keeps its own href and host coordinates', async () => {
  const state = await fixture()
  try {
    const selected = state.reader.selectFirstText()
    assert.equal(selected.text, currentText.slice(0, 60).trim())
    assert.equal(selected.locator.cfi, CURRENT_CFI)
    assert.equal(selected.locator.href, 'current.xhtml')
    assert.equal(selected.locator.selection.href, 'current.xhtml')
    assert.deepEqual(selected.rects, [{ x: 28, y: 20, width: 240, height: 20 }])
    assert.equal(state.previous.getSelection().rangeCount, 0, 'preloaded text must remain unselected')
    assert.equal(state.current.getSelection().toString(), currentText.slice(0, 60))
  } finally { state.restore() }
})

test('bookmark capture skips an offscreen preloaded chapter and reports only the visible bookmark', async () => {
  const state = await fixture()
  try {
    state.reader.bookmarkContext([
      { id: 'previous-mark', locator: { type: 'epub', cfi: PREVIOUS_CFI, href: 'previous.xhtml' } },
      { id: 'current-mark', locator: { type: 'epub', cfi: CURRENT_CFI, href: 'current.xhtml' } },
    ], 27)
    const context = state.messages.find(message => message.type === 'reader:bookmark-context')
    assert.equal(context.payload.requestId, 27)
    assert.equal(context.payload.locator.cfi, CURRENT_CFI)
    assert.equal(context.payload.locator.href, 'current.xhtml')
    assert.equal(context.payload.locator.selection.href, 'current.xhtml')
    assert.equal(context.payload.quote, currentText.slice(0, 32))
    assert.deepEqual(context.payload.visibleIds, ['current-mark'])
  } finally { state.restore() }
})

test('bookmark visibility refresh avoids scanning text for a new location, including when there are no bookmarks', async () => {
  const state = await fixture()
  try {
    let textWalks = 0
    const walk = state.current.createTreeWalker.bind(state.current)
    state.current.createTreeWalker = (...args) => { textWalks += 1; return walk(...args) }
    state.reader.bookmarkContext([], 29, false)
    state.reader.bookmarkContext([{ id: 'current-mark', locator: { type: 'epub', cfi: CURRENT_CFI, href: 'current.xhtml' } }], 30, false)
    const contexts = state.messages.filter(message => message.type === 'reader:bookmark-context').map(message => message.payload)
    assert.deepEqual(contexts, [
      { requestId: 29, locator: null, quote: '', visibleIds: [] },
      { requestId: 30, locator: null, quote: '', visibleIds: ['current-mark'] },
    ])
    assert.equal(textWalks, 0, 'a visibility refresh cannot walk every paragraph or measure its first visible character')
  } finally { state.restore() }
})

test('native stepping across single-page chunks in one spine uses the engine page identity', async () => {
  const state = await fixture('paginated')
  try {
    const nextCfi = 'epubcfi(/6/4!/4/4/1:0)'
    const next = publicationDocument('The next chunk contains a different original passage. '.repeat(3), 0)
    let current = state.current
    state.renderer.getContents = () => [{ doc: current, index: 1 }]
    state.renderer.page = 0
    state.renderer.pages = 1
    state.renderer.getPageTurnKey = () => current === state.current ? '10:0' : '11:0'
    state.reader.element.resolveCFI = () => ({ index: 1, anchor: doc => doc.createRange() })
    state.reader.element.next = async () => {
      current = next
      state.emitRelocate({ cfi: nextCfi, fraction: .6, section: { current: 1 }, range: next.createRange() })
    }
    const original = await state.reader.beginNativePreparation()
    const advanced = await state.reader.nativeStep(1)
    assert.equal(original.key, '10:0')
    assert.equal(advanced.key, '11:0')
    assert.equal(advanced.cfi, nextCfi)
    assert.notEqual(advanced.signature, original.signature)
    assert.equal(advanced.progress.locator.href, 'current.xhtml')
    await state.reader.finishNativePreparation(true)
  } finally { state.restore() }
})

test('chunk progress, selection and bookmark payloads use the book title instead of an unreliable TOC label', async () => {
  const state = await fixture()
  try {
    const placeholder = state.current.createElement('h1')
    placeholder.setAttribute('data-foliate-chunk', '1')
    state.current.body.appendChild(placeholder)
    state.reader.element.getProgressOf = () => ({ tocItem: { label: 'Wrong final chapter' } })
    state.emitRelocate({ cfi: CURRENT_CFI, fraction: .5, section: { current: 1 }, tocItem: { label: 'Wrong final chapter' }, range: state.current.createRange() })
    const progress = state.progresses.at(-1)
    assert.equal(progress.chapter, 'Book')
    assert.equal(progress.locator.chapter, 'Book')
    const selected = state.reader.selectFirstText()
    assert.equal(selected.locator.chapter, 'Book')
    assert.equal(selected.locator.cfi, CURRENT_CFI)
    state.reader.bookmarkContext([], 28)
    const context = state.messages.find(message => message.type === 'reader:bookmark-context')
    assert.equal(context.payload.locator.chapter, 'Book')
    assert.equal(context.payload.locator.cfi, CURRENT_CFI)
  } finally { state.restore() }
})

test('native fallback distinguishes chunks without an engine key and restores the same page CFI and identity', async () => {
  const state = await fixture('paginated')
  try {
    const nextCfi = 'epubcfi(/6/4!/4/4/1:0)'
    const next = publicationDocument('Another single-page chunk has its own original passage. '.repeat(3), 0)
    for (const doc of [state.current, next]) doc.body.firstChild.getBoundingClientRect = () => box(28, 20, 240, 20)
    let current = state.current
    const activate = doc => {
      current = doc
      state.emitRelocate({ cfi: doc === state.current ? CURRENT_CFI : nextCfi, fraction: doc === state.current ? .5 : .6, section: { current: 1 }, range: doc.createRange() })
    }
    state.renderer.getContents = () => [{ doc: current, index: 1 }]
    state.renderer.page = 0
    state.renderer.pages = 1
    // The upstream public key returns null for vertical pagination.
    state.renderer.getPageTurnKey = () => null
    state.reader.element.resolveCFI = cfi => ({
      index: 1,
      anchor: doc => doc === (cfi === CURRENT_CFI ? state.current : next) ? doc.createRange() : null,
    })
    state.reader.element.next = async () => activate(next)
    state.renderer.goTo = async target => activate(target.anchor(state.current) ? state.current : next)
    const original = await state.reader.beginNativePreparation()
    const advanced = await state.reader.nativeStep(1)
    assert.equal(advanced.cfi, nextCfi)
    assert.notEqual(advanced.key, original.key)
    const restored = await state.reader.nativeRestore(original)
    assert.equal(restored.cfi, original.cfi)
    assert.equal(restored.key, original.key)
    assert.equal(restored.signature, original.signature)
    await state.reader.finishNativePreparation(false)
  } finally { state.restore() }
})
