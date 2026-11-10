import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readerHarness } from './epub-reader-test-harness.mjs'

const CFI = 'epubcfi(/6/2!/4/2/1:0)'

function domElement(tag) {
  return {
    tag,
    style: {},
    dataset: {},
    className: '',
    textContent: '',
    children: [],
    append(...items) { this.children.push(...items) },
    remove() { this.removed = true },
  }
}

async function zeroSizeFixture(flow, previousMinHeight = '') {
  const previousDocument = globalThis.document
  const previousObserver = globalThis.ResizeObserver
  const previousFrame = globalThis.requestAnimationFrame
  const harness = readerHarness()
  await harness.reader.open('book.epub', 'Book', { flow })
  const terminalStyle = { minHeight: previousMinHeight }
  const terminal = {
    nodeType: 1,
    textContent: 'marked original text',
    style: terminalStyle,
    previousElementSibling: null,
    closest(selector) { return selector === '[data-foliate-chunk]' ? null : this },
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }),
  }
  const textNode = { nodeType: 3, parentElement: terminal }
  const anchor = {
    startContainer: textNode,
    endContainer: textNode,
    toString: () => 'marked original text',
  }
  const automaticFrame = callback => { queueMicrotask(callback); return 1 }
  const doc = {
    body: { lastElementChild: terminal },
    defaultView: { innerHeight: 4000, requestAnimationFrame: automaticFrame },
    fonts: { ready: Promise.resolve() },
    images: [],
    getSelection: () => ({ removeAllRanges() {} }),
  }
  const destinations = []
  harness.renderer.getBoundingClientRect = () => ({ height: 600 })
  harness.renderer.getContents = () => [{ index: 0, doc }]
  harness.renderer.goTo = async target => {
    destinations.push({ index: target.index, anchor: target.anchor(doc) })
  }
  harness.reader.element.resolveCFI = () => ({ index: 0, anchor: () => anchor })
  const layers = []
  harness.host.append = (...items) => layers.push(...items)
  globalThis.document.createElement = tag => domElement(tag)
  globalThis.requestAnimationFrame = automaticFrame
  return {
    harness,
    terminalStyle,
    destinations,
    anchor,
    layers,
    activeLayers: () => layers.filter(layer => layer.className === 'reader-terminal-recovery' && !layer.removed),
    restore() {
      globalThis.document = previousDocument
      globalThis.ResizeObserver = previousObserver
      globalThis.requestAnimationFrame = previousFrame
    },
  }
}

function assertCorrectDestination(fixture) {
  assert.ok(fixture.destinations.length > 0, 'the renderer must receive a navigation target')
  assert.equal(fixture.destinations.at(-1).index, 0)
  assert.equal(fixture.destinations.at(-1).anchor, fixture.anchor, 'the original resolved range must reach the renderer')
}

function assertLiveScrolledContent(fixture) {
  assert.equal(fixture.activeLayers().length, 0, 'a static recovery layer must not cover scrolling content')
  assert.equal(fixture.terminalStyle.minHeight, '', 'scrolling content must not retain a full-chapter minimum height')
  assertCorrectDestination(fixture)
}

test('paginated navigation preserves the terminal recovery for a zero-sized anchor', async () => {
  const fixture = await zeroSizeFixture('paginated')
  try {
    await fixture.harness.reader.goTo(CFI)
    assert.equal(fixture.terminalStyle.minHeight, '4000px')
    const [layer] = fixture.activeLayers()
    assert.equal(fixture.activeLayers().length, 1)
    assert.equal(layer.children[0].className, 'reader-terminal-recovery-body')
    const paragraph = layer.children[0].children[0]
    const mark = paragraph.children.find(child => typeof child === 'object' && child.tag === 'mark')
    assert.equal(mark.textContent, 'marked original text')
    assertCorrectDestination(fixture)
  } finally { fixture.restore() }
})

test('scrolled annotation navigation sends the real zero-sized target without a static layer or minimum height', async () => {
  const fixture = await zeroSizeFixture('scrolled')
  try {
    await fixture.harness.reader.goTo(CFI)
    assertLiveScrolledContent(fixture)
    assert.equal(fixture.destinations.length, 1)
  } finally { fixture.restore() }
})

test('scrolled reference navigation reaches the original target without a paginated recovery', async () => {
  const fixture = await zeroSizeFixture('scrolled')
  try {
    const receipt = await fixture.harness.reader.navigateReference({ operationId: 'reference', locator: CFI, citation: null })
    assert.equal(receipt.status, 'arrived', receipt.message)
    assert.equal(receipt.operationId, 'reference')
    assertLiveScrolledContent(fixture)
  } finally { fixture.restore() }
})

test('switching from pagination to scrolling removes the old layer and recovery geometry', async () => {
  const fixture = await zeroSizeFixture('paginated')
  try {
    await fixture.harness.reader.goTo(CFI)
    assert.equal(fixture.activeLayers().length, 1)
    assert.equal(fixture.terminalStyle.minHeight, '4000px')
    await fixture.harness.reader.setFlow('scrolled')
    assertLiveScrolledContent(fixture)
  } finally { fixture.restore() }
})

test('a recovery waiting for paint cannot leave geometry or a layer after scrolling is enabled', async () => {
  const fixture = await zeroSizeFixture('paginated')
  const pendingFrames = []
  try {
    globalThis.requestAnimationFrame = callback => { pendingFrames.push(callback); return 1 }
    const pending = fixture.harness.reader.goTo(CFI)
    for (let attempt = 0; attempt < 30 && pendingFrames.length === 0; attempt += 1) await Promise.resolve()
    assert.equal(pendingFrames.length, 1, 'recovery must be waiting for a paint frame before the flow changes')
    assert.equal(fixture.destinations.length, 1)
    await fixture.harness.reader.setFlow('scrolled')
    while (pendingFrames.length) pendingFrames.shift()()
    await pending
    assertLiveScrolledContent(fixture)
  } finally { fixture.restore() }
})

test('leaving pagination restores the authored minimum height', async () => {
  const fixture = await zeroSizeFixture('paginated', '17px')
  try {
    await fixture.harness.reader.goTo(CFI)
    assert.equal(fixture.terminalStyle.minHeight, '4000px')
    await fixture.harness.reader.setFlow('scrolled')
    assert.equal(fixture.terminalStyle.minHeight, '17px')
    assert.equal(fixture.activeLayers().length, 0)
  } finally { fixture.restore() }
})

test('leaving pagination preserves a later external minimum-height update', async () => {
  const fixture = await zeroSizeFixture('paginated', '17px')
  try {
    await fixture.harness.reader.goTo(CFI)
    fixture.terminalStyle.minHeight = '31px'
    await fixture.harness.reader.setFlow('scrolled')
    assert.equal(fixture.terminalStyle.minHeight, '31px')
    assert.equal(fixture.activeLayers().length, 0)
  } finally { fixture.restore() }
})
