import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readerHarness } from './epub-reader-test-harness.mjs'

function touch(x, y) {
  const point = { clientX: x, clientY: y }
  return {
    touches: [point], changedTouches: [point],
    target: { ownerDocument: { getSelection: () => ({ toString: () => '' }) }, closest: () => null },
  }
}

async function fixture(flow = 'scrolled') {
  const globals = new Map(['document', 'ResizeObserver'].map(key => [key, globalThis[key]]))
  const harness = readerHarness()
  await harness.reader.open('book.epub', 'Book', { flow })
  harness.log.length = 0
  return {
    ...harness,
    restore() {
      harness.reader.destroy()
      for (const [key, value] of globals) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
    },
  }
}

const chapterMovements = harness => harness.log.filter(([operation]) => operation === 'next' || operation === 'prev')

function swipe(emit, from, to) {
  emit('touchstart', touch(...from))
  emit('touchmove', touch(...to))
  emit('touchend', touch(...to))
}

test('chapter boundary gestures leave continuous scrolling to Foliate without another next or prev', async () => {
  const harness = await fixture()
  try {
    Object.assign(harness.renderer, { start: 1200, end: 1800, viewSize: 1800 })
    swipe(harness.emitRenderer, [180, 500], [180, 250])
    Object.assign(harness.renderer, { start: 0, end: 600 })
    swipe(harness.emitRenderer, [180, 200], [180, 450])
    Object.assign(harness.renderer, { end: 300, viewSize: 300 })
    swipe(harness.emitRenderer, [180, 500], [180, 250])
    assert.deepEqual(chapterMovements(harness), [])

    // Verify the harness still observes explicit chapter navigation.
    await harness.reader.next()
    await harness.reader.prev()
    assert.deepEqual(chapterMovements(harness), [['next'], ['prev']])
  } finally { harness.restore() }
})

test('publication iframe gestures do not add chapter navigation at either boundary', async () => {
  const harness = await fixture()
  try {
    const listeners = new Map()
    harness.emitLoad({ addEventListener(name, callback) { listeners.set(name, [...(listeners.get(name) ?? []), callback]) } })
    const emit = (name, event) => { for (const callback of listeners.get(name) ?? []) callback(event) }
    Object.assign(harness.renderer, { start: 1200, end: 1800 })
    swipe(emit, [180, 500], [180, 250])
    Object.assign(harness.renderer, { start: 0, end: 600 })
    swipe(emit, [180, 200], [180, 450])
    assert.deepEqual(chapterMovements(harness), [])
  } finally { harness.restore() }
})

test('switching flow does not install a second touch navigation path', async () => {
  const harness = await fixture('paginated')
  try {
    Object.assign(harness.renderer, { start: 1200, end: 1800 })
    swipe(harness.emitRenderer, [180, 500], [180, 250])
    await harness.reader.setFlow('scrolled')
    swipe(harness.emitRenderer, [180, 500], [180, 250])
    await harness.reader.setFlow('paginated')
    swipe(harness.emitRenderer, [180, 500], [180, 250])
    assert.deepEqual(chapterMovements(harness), [])
  } finally { harness.restore() }
})
