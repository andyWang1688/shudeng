import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const paginatorURL = import.meta.resolve('foliate-js/paginator.js')
const dependencies = await import(new URL('./section-chunks.js', paginatorURL))
const installedSource = readFileSync(new URL(paginatorURL), 'utf8')
// Execute the installed constructor and every real event/timer path. Only stop
// at the expensive layout boundary: these tests count when it is entered, not
// the browser's geometry or the contents of the resulting visible range.
const measurementEntry = '    #afterScroll(reason) {\n'
assert.equal(installedSource.split(measurementEntry).length, 2, 'the installed measurement entry must be uniquely identifiable')
const instrumentedSource = installedSource.replace(measurementEntry, measurementEntry
    + '        globalThis.measurements.push({ reason, at: Date.now() }); return;\n')
// Expose only flag setup for navigation and an in-flight browser layout. Neither
// test entry calls, replaces or copies the scroll scheduler.
const classEntry = 'export class Paginator extends HTMLElement {\n'
assert.equal(instrumentedSource.split(classEntry).length, 2, 'the installed Paginator class must be uniquely identifiable')
const sourceWithStateSetup = instrumentedSource.replace(classEntry, classEntry
    + '    markNavigationAnchorForSchedulingTest() { this.#justAnchored = true }\n'
    + '    setStabilizingForSchedulingTest(value) { this.#stabilizing = value }\n')
const compiled = ts.transpileModule(sourceWithStateSetup, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function browserClock() {
    let now = 10_000
    let serial = 0
    const timers = new Map()
    const setTimeout = (callback, delay = 0) => {
        const id = ++serial
        timers.set(id, { at: now + Math.max(0, Number(delay)), callback })
        return id
    }
    return {
        now: () => now,
        setTimeout,
        clearTimeout: id => timers.delete(id),
        async tick(milliseconds) {
            const end = now + milliseconds
            let callbacks = 0
            while (true) {
                const next = [...timers].filter(([, timer]) => timer.at <= end)
                    .sort(([idA, a], [idB, b]) => a.at - b.at || idA - idB)[0]
                if (!next) break
                assert.ok(++callbacks < 1000, 'browser timer callbacks must settle')
                const [id, timer] = next
                now = timer.at
                timers.delete(id)
                timer.callback()
                await Promise.resolve()
            }
            now = end
            await Promise.resolve()
        },
    }
}

class BrowserElement extends EventTarget {
    attributes = new Map()
    style = { setProperty() {}, removeProperty() {} }
    children = []
    nodeType = 1
    attachShadow() {
        const nodes = new Map()
        this.shadowRoot = {
            innerHTML: '',
            getElementById(id) {
                if (!nodes.has(id)) nodes.set(id, new BrowserElement())
                return nodes.get(id)
            },
        }
        return this.shadowRoot
    }
    setAttribute(name, value) {
        const old = this.getAttribute(name)
        this.attributes.set(name, String(value))
        // Custom elements receive this callback even when setAttribute repeats
        // the current value; that browser behavior matters for redundant flow.
        if (this.constructor.observedAttributes?.includes(name))
            this.attributeChangedCallback(name, old, String(value))
    }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    hasAttribute(name) { return this.attributes.has(name) }
    getBoundingClientRect() { return { left: 0, top: 0, width: 375, height: 600, right: 375, bottom: 600 } }
}

function fixture(surface) {
    const clock = browserClock()
    const measurements = []
    const registrations = new Map()
    const module = { exports: {} }
    const document = new BrowserElement()
    document.nodeType = 9
    document.documentElement = { clientWidth: 375 }
    document.hidden = false
    const environment = {
        module, exports: module.exports, measurements,
        require(name) {
            assert.equal(name, './section-chunks.js')
            return dependencies
        },
        Event, EventTarget, HTMLElement: BrowserElement, document,
        NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        matchMedia: () => new EventTarget(),
        customElements: { define: (name, constructor) => registrations.set(name, constructor) },
        visualViewport: { scale: 1 },
        setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        requestAnimationFrame: callback => clock.setTimeout(() => callback(clock.now()), 16),
        cancelAnimationFrame: clock.clearTimeout,
        Date: class extends Date { static now() { return clock.now() } },
        performance: { now: clock.now },
    }
    environment.window = environment
    runInNewContext(compiled, environment, { filename: new URL(paginatorURL).pathname })
    const { Paginator } = module.exports
    assert.equal(registrations.get('foliate-paginator'), Paginator)
    const paginator = new Paginator()
    paginator.setAttribute('no-preload', '')
    paginator.setAttribute('flow', 'scrolled')
    const container = paginator.shadowRoot.getElementById('container')
    const touchTarget = surface === 'publication document' ? document : paginator
    if (touchTarget === document) {
        const loaded = new Event('load')
        Object.defineProperty(loaded, 'detail', { value: { doc: document } })
        paginator.dispatchEvent(loaded)
    }
    let offset = 0
    return {
        clock, measurements,
        markNavigationAnchor: () => paginator.markNavigationAnchorForSchedulingTest(),
        setStabilizing: value => paginator.setStabilizingForSchedulingTest(value),
        setFlow: value => paginator.setAttribute('flow', value),
        destroy: () => paginator.destroy(),
        touch(type) {
            const point = { clientX: 180, clientY: 400 - offset, screenX: 180, screenY: 400 - offset }
            const event = new Event(type, { cancelable: true })
            Object.defineProperties(event, {
                timeStamp: { value: clock.now() },
                touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] },
                changedTouches: { value: [point] },
            })
            touchTarget.dispatchEvent(event)
        },
        scroll() {
            offset += 20
            container.scrollTop = offset
            container.dispatchEvent(new Event('scroll'))
        },
    }
}

for (const surface of ['paginator host', 'publication document']) {
    for (const release of ['touchend', 'touchcancel']) {
        test(surface + ': continuous scrolling and a resting finger defer measurement until ' + release + ' settles', async () => {
            const state = fixture(surface)
            const counts = []
            state.touch('touchstart')
            state.scroll()
            for (let index = 0; index < 15; index++) {
                await state.clock.tick(100)
                state.touch('touchmove')
                state.scroll()
            }
            counts.push(state.measurements.length)
            // No further scroll event is guaranteed when a stationary finger
            // finally lifts, so the release must restart the trailing work.
            await state.clock.tick(600)
            counts.push(state.measurements.length)
            state.touch(release)
            await state.clock.tick(249)
            counts.push(state.measurements.length)
            await state.clock.tick(1)
            counts.push(state.measurements.length)
            await state.clock.tick(1000)
            counts.push(state.measurements.length)
            assert.deepEqual(counts, [0, 0, 0, 1, 1], 'measurement counts: dragging, finger resting, release+249ms, release+250ms, later idle')
            assert.equal(state.measurements[0].reason, 'scroll')
        })
    }

    test(surface + ': a tap with no scroll does not schedule a position measurement', async () => {
        const state = fixture(surface)
        state.touch('touchstart')
        await state.clock.tick(600)
        state.touch('touchend')
        await state.clock.tick(1500)
        assert.deepEqual(state.measurements, [])
    })

    test(surface + ': an earlier navigation anchor cannot swallow the final position of a real touch scroll', async () => {
        const state = fixture(surface)
        state.markNavigationAnchor()
        state.touch('touchstart')
        state.touch('touchmove')
        state.scroll()
        await state.clock.tick(600)
        assert.equal(state.measurements.length, 0)
        state.touch('touchend')
        await state.clock.tick(250)
        assert.equal(state.measurements.length, 1, 'the user moved away from the navigation anchor')
    })
}

test('a navigation-generated scroll still suppresses its own trailing relocation once', async () => {
    const state = fixture('paginator host')
    state.markNavigationAnchor()
    state.scroll()
    await state.clock.tick(250)
    assert.equal(state.measurements.length, 0)
    state.scroll()
    await state.clock.tick(250)
    assert.equal(state.measurements.length, 1, 'a later non-touch scroll is still reported')
})

test('non-touch scrolling still measures periodically and reports its final settled position', async () => {
    const state = fixture('paginator host')
    state.scroll()
    for (let index = 0; index < 25; index++) {
        await state.clock.tick(100)
        state.scroll()
    }
    assert.deepEqual(state.measurements.map(({ at }) => at), [11_000, 12_000])
    await state.clock.tick(249)
    assert.equal(state.measurements.length, 2)
    await state.clock.tick(1)
    assert.deepEqual(state.measurements.map(({ at }) => at), [11_000, 12_000, 12_750])
    assert.ok(state.measurements.every(({ reason }) => reason === 'scroll'))
})

test('destroying the paginator retires a pending touch-release measurement', async () => {
    const state = fixture('publication document')
    state.touch('touchstart')
    state.scroll()
    state.touch('touchend')
    await state.clock.tick(100)
    assert.equal(state.measurements.length, 0)
    state.destroy()
    await state.clock.tick(2000)
    assert.deepEqual(state.measurements, [], 'a settled browser timer cannot measure a destroyed reader')
})

test('repeating the current scrolled flow cannot drop the pending final position of a resting finger', async () => {
    const state = fixture('paginator host')
    state.touch('touchstart')
    state.scroll()
    await state.clock.tick(600)
    assert.equal(state.measurements.length, 0)
    state.setFlow('scrolled')
    state.touch('touchend')
    await state.clock.tick(250)
    assert.equal(state.measurements.length, 1, 'a redundant flow attribute must preserve the user scroll waiting for release')
})

test('a touch-release position deferred by layout is eventually measured without another scroll event', async () => {
    const state = fixture('paginator host')
    const counts = []
    state.touch('touchstart')
    state.scroll()
    state.touch('touchend')
    state.setStabilizing(true)
    await state.clock.tick(1000)
    counts.push(state.measurements.length)
    state.setStabilizing(false)
    await state.clock.tick(249)
    counts.push(state.measurements.length)
    await state.clock.tick(1)
    counts.push(state.measurements.length)
    await state.clock.tick(1000)
    counts.push(state.measurements.length)
    assert.deepEqual(counts, [0, 0, 1, 1], 'measure once after layout settles, without repeated measurement or more scroll events')
})
