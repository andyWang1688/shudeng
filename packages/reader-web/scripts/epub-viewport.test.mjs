import { test } from 'node:test'
import assert from 'node:assert/strict'
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

test('visible bookmarks use the host-clipped iframe viewport', () => {
  const host = { getBoundingClientRect: () => ({ left: 14, right: 361, top: 28, bottom: 728 }) }
  const doc = { defaultView: { innerWidth: 3 * SIZE, innerHeight: HEIGHT, frameElement: { getBoundingClientRect: () => ({ left: 14 - SIZE, top: 28 }) } } }
  assert.deepEqual(visibleDocumentViewport(doc, host), { left: SIZE, right: 2 * SIZE, top: 0, bottom: HEIGHT })
})

test('actual reader pointer handlers use the host-clipped iframe for tap zones', async () => {
  const { reader, host } = readerHarness()
  await reader.open('book.epub', 'Book')
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
})

test('native preparation completes, cancels, aborts and propagates paint failure', async () => {
  const { reader, log } = readerHarness()
  await reader.open('book.epub', 'Book')
  const page = { cfi: 'epubcfi(/6/2!/4/2/1:0)', key: '0:9:39', signature: 'same text' }
  reader.nativePage = async () => page
  assert.equal(await reader.beginNativePreparation(), page)
  assert.equal(await reader.finishNativePreparation(true), page)
  await reader.beginNativePreparation()
  await reader.finishNativePreparation(false)
  assert.ok(log.some(item => item[0] === 'goTo'), 'cancel calls the original CFI restore path')
  await reader.beginNativePreparation()
  reader.waitForPaint = async () => {}
  await reader.abortNativePreparation()
  assert.equal(reader.nativeOriginal, null)
  assert.equal(reader.nativePreparing, false)
  reader.nativePage = async () => { throw new Error('paint failed') }
  await assert.rejects(reader.beginNativePreparation(), /paint failed/)
  assert.equal(reader.nativePreparing, false)
})

for (const where of ['goTo', 'waitForPaint']) test('failed native abort retains its explicit target and retries recovery before a new preparation: ' + where, async () => {
  const published = []
  const { reader, emitRelocate } = readerHarness({ onProgress: progress => published.push(progress) })
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
  assert.equal(reader.nativeOriginal, null)
  assert.ok(published.every(progress => progress.locator.cfi !== temporary.cfi))
})
