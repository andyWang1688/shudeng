#!/usr/bin/env node
/**
 * task-87 WebView 阅读器运行时验证：
 * - 启动 headless Chrome + CDP（不依赖 Playwright）
 * - 打开 EPUB/PDF fixture，验证 ready/selection/progress/annotation 消息
 * - 截图、PDF 文本坐标、大文件内存、深色/字号/滚动
 * 输出：.scratch/impl/rn-langchain-reader/screenshots + results.json + console.log
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(new URL('../../..', import.meta.url).pathname)
const EVIDENCE = resolve(ROOT, '.scratch/impl/rn-langchain-reader')
const SHOTS = resolve(EVIDENCE, 'screenshots')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PREVIEW_URL = 'http://127.0.0.1:4173/'
const DEBUG_PORT = 9333
const LARGE_PDF = resolve(ROOT, 'delivery/pdf-samples/02-扫描型-正文.pdf')
const LARGE_PDF_TARGET = resolve(ROOT, 'packages/reader-web/public/fixtures/large.pdf')

mkdirSync(SHOTS, { recursive: true })
rmSync(resolve(EVIDENCE, 'chrome-profile'), { recursive: true, force: true })

const results = {
  startedAt: new Date().toISOString(),
  chrome: CHROME,
  scenarios: {},
  console: [],
  errors: [],
}
const consoleLines = []
const log = (...args) => console.log(...args)

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.ready = new Promise((resolvePromise, reject) => {
      this.ws.addEventListener('open', resolvePromise)
      this.ws.addEventListener('error', reject)
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
        return
      }
      if (message.method) {
        for (const handler of this.listeners.get(message.method) ?? []) handler(message.params)
      }
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(handler)
  }
  close() { this.ws.close() }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`${url} → ${response.status}`)
  return response.json()
}

async function waitForHttp(url, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* retry */ }
    await sleep(250)
  }
  throw new Error(`timeout waiting for ${url}`)
}

async function main() {
  const preview = spawn(
    'pnpm',
    ['--filter', '@shudeng/reader-web', 'preview'],
    { cwd: ROOT, stdio: 'ignore', detached: false },
  )
  try {
    await waitForHttp(PREVIEW_URL)
    log('preview ready', PREVIEW_URL)

    rmSync(resolve(EVIDENCE, 'chrome-profile'), { recursive: true, force: true })
    const chrome = spawn(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--hide-scrollbars',
      '--window-size=430,932',
      '--force-device-scale-factor=2',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${resolve(EVIDENCE, 'chrome-profile')}`,
      PREVIEW_URL,
    ], { stdio: 'ignore' })

    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
    const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
    const page = targets.find((target) => target.type === 'page')
    if (!page) throw new Error('no chrome page target')
    const cdp = new CDP(page.webSocketDebuggerUrl)

    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      const line = `[console.${type}] ` + args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
      consoleLines.push(line)
      if (type === 'error') results.console.push(line)
    })
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      const line = `[exception] ${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`
      results.console.push(line)
    })
    cdp.on('Log.entryAdded', ({ entry }) => {
      consoleLines.push(`[log.${entry.level}] ${entry.text}`)
      if (entry.level === 'error') results.console.push(`[log.error] ${entry.text}`)
    })

    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Log.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430, height: 932, deviceScaleFactor: 2, mobile: true,
    })

    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
      return result.result?.value
    }

    const waitReady = async (timeout = 30000) => {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (await evaluate('window.__readerReady === true')) return true
        await sleep(250)
      }
      throw new Error('reader not ready in time')
    }

    const navigate = async (path) => {
      await cdp.send('Page.navigate', { url: PREVIEW_URL + path })
      await sleep(700)
      await waitReady()
      await sleep(900)
    }

    const screenshot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(resolve(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
    }

    const messages = async () => evaluate('window.__readerMessages')
    const state = async () => evaluate('window.__readerHarness.getState()')

    const run = async (name, fn) => {
      const started = Date.now()
      try {
        const value = await fn()
        results.scenarios[name] = { ok: true, ms: Date.now() - started, ...value }
        log(`PASS ${name}`, JSON.stringify(value).slice(0, 240))
      } catch (error) {
        results.scenarios[name] = { ok: false, ms: Date.now() - started, error: String(error) }
        results.errors.push(`${name}: ${error}`)
        log(`FAIL ${name}`, String(error))
      }
    }

    await run('epub-open-progress', async () => {
      await navigate('?format=epub&fixture=search-fixture&title=WebView-EPUB')
      await screenshot('epub-light-portrait')
      const all = await messages()
      const ready = all.find((message) => message.type === 'reader:ready')
      const progress = all.filter((message) => message.type === 'reader:progress').at(-1)
      const current = await state()
      if (!ready) throw new Error('missing reader:ready')
      if (ready.payload.format !== 'epub') throw new Error('wrong ready format')
      if (!progress?.payload?.locator?.cfi) throw new Error('missing epub progress cfi')
      return {
        readyFormat: ready.payload.format,
        cfi: progress.payload.locator.cfi,
        fraction: progress.payload.fraction,
        chapter: current?.chapter,
        flow: current?.flow,
      }
    })

    await run('epub-page-turn', async () => {
      const before = await state()
      await evaluate('window.__readerHarness.next()')
      await sleep(700)
      const after = await state()
      await evaluate('window.__readerHarness.prev()')
      await sleep(500)
      if (!before?.currentCfi || !after?.currentCfi) throw new Error('missing cfi')
      if (after.currentCfi === before.currentCfi) throw new Error('next() did not move location')
      return { from: before.currentCfi, to: after.currentCfi }
    })

    await run('epub-selection-cfi', async () => {
      const selection = await evaluate('window.__readerHarness.selectFirstText()')
      await sleep(400)
      const all = await messages()
      const selected = all.filter((message) => message.type === 'reader:selection').at(-1)
      if (!selection) throw new Error('selection hook returned null')
      if (!selected?.payload?.locator?.cfi) throw new Error('missing selection cfi')
      await screenshot('epub-selection')
      return {
        text: String(selected.payload.text).slice(0, 80),
        cfi: selected.payload.locator.cfi,
        rectCount: selected.payload.rects?.length ?? 0,
      }
    })

    await run('epub-annotation-anchor', async () => {
      const selected = await evaluate('window.__readerHarness.selectFirstText()')
      await sleep(350)
      const cfi = selected?.locator?.cfi
      if (!cfi) throw new Error('no selection cfi for annotation')
      await evaluate('window.__readerHarness.clearSelection()')
      await evaluate(`window.__readerHarness.addAnnotation(${JSON.stringify({
        id: 'a1', format: 'epub', locator: selected.locator, color: 'yellow', text: selected.text,
      })})`)
      await sleep(500)
      const annotated = await state()
      await screenshot('epub-annotation')
      await evaluate(`window.__readerHarness.removeAnnotation('a1')`)
      await evaluate('window.__readerHarness.clearSelection()')
      await sleep(300)
      const removed = await state()
      if ((annotated?.annotationCount ?? 0) < 1) throw new Error('annotation not added')
      if ((removed?.annotationCount ?? 0) !== 0) throw new Error('annotation not removed')
      return { cfi, added: annotated.annotationCount, removed: removed.annotationCount }
    })

    await run('epub-dark-font-scroll', async () => {
      await evaluate('window.__readerHarness.clearSelection()')
      await evaluate(`window.__readerHarness.theme('dark')`)
      await evaluate(`window.__readerHarness.fontSize(24)`)
      await evaluate(`window.__readerHarness.flow('scrolled')`)
      await sleep(800)
      await screenshot('epub-dark-font-scrolled')
      const current = await state()
      if (current?.theme !== 'dark') throw new Error('theme not applied')
      if (current?.fontSize !== 24) throw new Error('font size not applied')
      if (current?.flow !== 'scrolled') throw new Error('flow not applied')
      return { theme: current.theme, fontSize: current.fontSize, flow: current.flow }
    })

    await run('pdf-open-text-coordinates', async () => {
      await navigate('?format=pdf&fixture=text&title=WebView-PDF')
      await screenshot('pdf-light-portrait')
      const current = await state()
      const coords = await evaluate('window.__readerHarness.getTextCoordinates(1)')
      const all = await messages()
      const ready = all.find((message) => message.type === 'reader:ready')
      const progress = all.filter((message) => message.type === 'reader:progress').at(-1)
      if (!ready) throw new Error('missing pdf ready')
      if (!coords?.length) throw new Error('no pdf text coordinates')
      const sample = coords.find((item) => item.text.trim())
      if (!sample || sample.x < 0 || sample.x > 1 || sample.y < 0 || sample.y > 1) {
        throw new Error('invalid normalized coordinate')
      }
      return {
        pages: current?.totalPages,
        textItems: coords.length,
        sample: { text: sample.text.slice(0, 40), x: sample.x, y: sample.y, height: sample.height },
        progressPage: progress?.payload?.page,
      }
    })

    await run('pdf-selection-annotation', async () => {
      const selection = await evaluate('window.__readerHarness.selectFirstText()')
      await sleep(400)
      const all = await messages()
      const selected = all.filter((message) => message.type === 'reader:selection').at(-1)
      if (!selected?.payload?.locator?.rects?.length) throw new Error('missing pdf selection rects')
      await screenshot('pdf-selection')
      const locator = selected.payload.locator
      await evaluate(`window.__readerHarness.addAnnotation(${JSON.stringify({
        id: 'p1', format: 'pdf', locator, color: 'green', text: selected.payload.text,
      })})`)
      await sleep(400)
      await screenshot('pdf-annotation')
      const annotated = await state()
      await evaluate(`document.querySelector('.pdf-annotation')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
      await sleep(300)
      const allAfter = await messages()
      const annotationSelected = allAfter.some((message) => message.type === 'reader:annotationSelected')
      await evaluate(`window.__readerHarness.removeAnnotation('p1')`)
      await sleep(250)
      return {
        text: String(selected.payload.text).slice(0, 60),
        page: locator.page,
        rects: locator.rects.length,
        annotations: annotated?.annotationCount,
        annotationSelected,
      }
    })

    await run('pdf-zoom-theme', async () => {
      await evaluate('window.__readerHarness.zoom(1.6)')
      await sleep(600)
      const zoomed = await state()
      await screenshot('pdf-zoom')
      if (zoomed?.zoom !== 1.6) throw new Error('zoom not applied')
      await evaluate('window.__readerHarness.zoom(1)')
      await evaluate('window.__readerHarness.clearSelection()')
      await evaluate(`window.__readerHarness.theme('dark')`)
      await sleep(600)
      await screenshot('pdf-dark')
      const current = await state()
      if (current?.theme !== 'dark') throw new Error('dark not applied')
      return { zoom: zoomed.zoom, finalZoom: current.zoom, theme: current.theme, page: current.page }
    })

    await run('pdf-large-memory', async () => {
      if (!existsSync(LARGE_PDF)) throw new Error('large sample missing')
      copyFileSync(LARGE_PDF, LARGE_PDF_TARGET)
      copyFileSync(LARGE_PDF, resolve(ROOT, 'packages/reader-web/dist/fixtures/large.pdf'))
      await navigate('?format=pdf&fixture=large&title=WebView-PDF-Large')
      await sleep(2500)
      const before = await evaluate('window.__readerHarness.getMemory()')
      const current = await state()
      await screenshot('pdf-large')
      await evaluate('window.__readerHarness.next()')
      await sleep(1800)
      const after = await evaluate('window.__readerHarness.getMemory()')
      const second = await state()
      if (!current?.totalPages || current.totalPages < 2) throw new Error('large pdf not multi-page')
      return {
        pages: current.totalPages,
        heapBeforeMB: before?.usedJSHeapSize ? Math.round(before.usedJSHeapSize / 1048576 * 10) / 10 : null,
        heapAfterMB: after?.usedJSHeapSize ? Math.round(after.usedJSHeapSize / 1048576 * 10) / 10 : null,
        pageAfterNext: second?.page,
      }
    })

    writeFileSync(resolve(EVIDENCE, 'result.json'), JSON.stringify(results, null, 2))
    writeFileSync(resolve(EVIDENCE, 'console.log'), consoleLines.join('\n'))
    log('results written', resolve(EVIDENCE, 'result.json'))
    log('errors:', results.errors.length, results.console.length)

    cdp.close()
    chrome.kill('SIGTERM')
    await sleep(500)
    if (existsSync(LARGE_PDF_TARGET)) rmSync(LARGE_PDF_TARGET)
    rmSync(resolve(ROOT, 'packages/reader-web/dist/fixtures/large.pdf'), { force: true })
    if (results.errors.length > 0 || results.console.length > 0) {
      const failed = Object.entries(results.scenarios).filter(([, value]) => !value.ok)
      if (failed.length > 0) process.exitCode = 1
    }
  } finally {
    preview.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error('verify crashed', error)
  writeFileSync(resolve(EVIDENCE, 'result.json'), JSON.stringify({ ...results, crashes: String(error) }, null, 2))
  process.exitCode = 1
})
