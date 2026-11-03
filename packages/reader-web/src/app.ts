import './styles.css'
import { bridge } from './bridge'
import { EpubReader } from './epub-reader'
import type { PdfReader } from './pdf-reader'
import type {
  AnnotationPayload,
  HostToReader,
  OpenPayload,
  ReaderFlow,
  ReaderTheme,
  ProgressPayload,
  ReaderToHost,
} from './protocol'

type Reader = EpubReader | PdfReader
type PdfReaderClass = typeof import('./pdf-reader').PdfReader

// inline（native WebView）入口不加载 pdf.js；只有 Web 入口通过 setPdfReader 注入。
let PdfReaderClassRef: PdfReaderClass | null = null

export function setPdfReader(PdfReader: PdfReaderClass): void {
  PdfReaderClassRef = PdfReader
}

function epubReader(): EpubReader | null {
  return reader instanceof EpubReader ? reader : null
}

function pdfReader(): PdfReader | null {
  return currentFormat === 'pdf' && reader ? (reader as PdfReader) : null
}

const titleEl = document.querySelector<HTMLElement>('#title')!
const metaEl = document.querySelector<HTMLElement>('#meta')!
const progressEl = document.querySelector<HTMLElement>('#progress')!
const readerEl = document.querySelector<HTMLElement>('#reader')!
const themeButton = document.querySelector<HTMLButtonElement>('#theme')!
const fontButton = document.querySelector<HTMLButtonElement>('#font')!
const flowButton = document.querySelector<HTMLButtonElement>('#flow')!
const prevButton = document.querySelector<HTMLButtonElement>('#prev')!
const nextButton = document.querySelector<HTMLButtonElement>('#next')!

let reader: Reader | null = null
let currentFormat: 'epub' | 'pdf' | null = null
let currentTitle = ''
let currentTheme: ReaderTheme = 'light'
let currentFontSize = 18
let currentFlow: ReaderFlow = 'paginated'
let totalPages = 0

function send(message: ReaderToHost): void {
  bridge.send(message)
}

function updateMeta(): void {
  if (!reader) {
    metaEl.textContent = '准备中…'
    return
  }
  const state = reader.getState()
  if (currentFormat === 'pdf') {
    metaEl.textContent = `第 ${state.page ?? 1} / ${state.totalPages ?? totalPages} 页`
  } else {
    metaEl.textContent = String(state.chapter ?? '正文')
  }
  flowButton.textContent = currentFlow === 'scrolled' ? '▤' : '≡'
  themeButton.textContent = currentTheme === 'dark' ? '☀' : '◐'
}

function onProgress(payload: ProgressPayload): void {
  if (!payload) return
  const fraction = typeof payload.fraction === 'number' ? payload.fraction : 0
  progressEl.textContent = `${Math.round(fraction * 100)}%`
  if (payload.totalPages) {
    totalPages = payload.totalPages
    metaEl.textContent = `第 ${payload.page ?? 1} / ${payload.totalPages} 页`
  } else if (payload.chapter) {
    metaEl.textContent = String(payload.chapter)
  }
  send({ type: 'reader:progress', payload })
}

function decodeBase64(input: string): Uint8Array {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function resetReader(): void {
  reader = null
  currentFormat = null
  currentTitle = ''
  totalPages = 0
  progressEl.textContent = '0%'
  readerEl.replaceChildren()
}

async function open(payload: OpenPayload): Promise<void> {
  resetReader()
  window.__readerReady = false
  currentFormat = payload.format
  currentTitle = payload.title ?? payload.url.split('/').pop() ?? '书灯'
  currentTheme = payload.theme ?? currentTheme
  currentFontSize = payload.fontSize ?? currentFontSize
  currentFlow = payload.flow ?? currentFlow
  titleEl.textContent = currentTitle
  document.body.dataset.theme = currentTheme
  document.body.dataset.format = payload.format
  readerEl.dataset.format = payload.format
  readerEl.dataset.theme = currentTheme

  try {
    if (payload.format === 'epub') {
      const epub = new EpubReader(readerEl, onProgress)
      reader = epub
      const epubBytes = payload.dataBase64 ? decodeBase64(payload.dataBase64) : null
      const epubSource = epubBytes
        ? new File(
            [epubBytes.buffer.slice(epubBytes.byteOffset, epubBytes.byteOffset + epubBytes.byteLength) as ArrayBuffer],
            `${currentTitle}.epub`,
            { type: payload.mimeType ?? 'application/epub+zip' },
          )
        : payload.url
      await epub.open(epubSource, currentTitle)
      await epub.setTheme(currentTheme)
      await epub.setFontSize(currentFontSize)
      await epub.setFlow(currentFlow)
      if (payload.initialLocation) await epub.goTo(payload.initialLocation)
    } else {
      if (!PdfReaderClassRef) throw new Error('此构建不包含 PDF 阅读器')
      const pdf = new PdfReaderClassRef(readerEl, onProgress)
      reader = pdf
      const pdfSource = payload.dataBase64 ? decodeBase64(payload.dataBase64) : payload.url
      await pdf.open(pdfSource, currentTitle, payload.initialLocation)
      await pdf.setTheme(currentTheme)
    }
    window.__readerReady = true
    updateMeta()
    send({
      type: 'reader:state',
      payload: { format: payload.format, ready: true, title: currentTitle },
    })
  } catch (error) {
    window.__readerReady = true
    const message = error instanceof Error ? error.message : String(error)
    metaEl.textContent = '打开失败'
    send({ type: 'reader:error', payload: { message } })
  }
}

async function dispatch(message: HostToReader): Promise<void> {
  try {
    switch (message.type) {
      case 'reader:open':
        await open(message.payload)
        return
      case 'reader:theme':
        currentTheme = message.payload.theme
        document.body.dataset.theme = currentTheme
        readerEl.dataset.theme = currentTheme
        if (epubReader()) await epubReader()!.setTheme(currentTheme)
        if (pdfReader()) await pdfReader()!.setTheme(currentTheme)
        break
      case 'reader:fontSize':
        currentFontSize = message.payload.fontSize
        if (epubReader()) await epubReader()!.setFontSize(currentFontSize)
        break
      case 'reader:flow':
        currentFlow = message.payload.flow
        if (epubReader()) await epubReader()!.setFlow(currentFlow)
        if (pdfReader()) await pdfReader()!.setFlow(currentFlow)
        break
      case 'reader:goTo':
        if (epubReader()) await epubReader()!.goTo(message.payload.locator)
        if (pdfReader()) {
          const page = Number(message.payload.locator.replace(/\D/g, '')) || 1
          await pdfReader()!.goToPage(page)
        }
        break
      case 'reader:next':
        await reader?.next()
        break
      case 'reader:prev':
        await reader?.prev()
        break
      case 'reader:zoom':
        if (pdfReader()) await pdfReader()!.setZoom(message.payload.scale)
        break
      case 'reader:annotation:add':
        await reader?.addAnnotation(message.payload)
        break
      case 'reader:annotation:remove':
        await reader?.removeAnnotation(message.payload.id)
        break
      case 'reader:selection:clear':
        reader?.clearSelection()
        break
    }
    updateMeta()
  } catch (error) {
    send({ type: 'reader:error', payload: { message: error instanceof Error ? error.message : String(error) } })
  }
}

bridge.onMessage((message) => {
  void dispatch(message)
})

themeButton.addEventListener('click', () => {
  void dispatch({ type: 'reader:theme', payload: { theme: currentTheme === 'dark' ? 'light' : 'dark' } })
})
fontButton.addEventListener('click', () => {
  const sizes = [16, 18, 21, 24]
  const next = sizes[(sizes.indexOf(currentFontSize) + 1) % sizes.length] ?? 18
  void dispatch({ type: 'reader:fontSize', payload: { fontSize: next } })
})
flowButton.addEventListener('click', () => {
  void dispatch({ type: 'reader:flow', payload: { flow: currentFlow === 'scrolled' ? 'paginated' : 'scrolled' } })
})
prevButton.addEventListener('click', () => { void dispatch({ type: 'reader:prev' }) })
nextButton.addEventListener('click', () => { void dispatch({ type: 'reader:next' }) })

// 自动化验证入口；只暴露只读/显式命令，不绕过协议安全性。
declare global {
  interface Window {
    __readerHarness?: Record<string, unknown>
    __readerReady?: boolean
  }
}

window.__readerHarness = {
  open,
  dispatch,
  getState: () => reader?.getState() ?? null,
  getMessages: () => bridge.messages,
  selectFirstText: () => reader?.selectFirstText() ?? null,
  clearSelection: () => { reader?.clearSelection() },
  getTextCoordinates: (page?: number) => pdfReader()?.getTextCoordinates(page) ?? [],
  getMemory: () => pdfReader()?.getMemory() ?? {},
  addAnnotation: (payload: AnnotationPayload) => dispatch({ type: 'reader:annotation:add', payload }),
  removeAnnotation: (id: string) => dispatch({ type: 'reader:annotation:remove', payload: { id } }),
  theme: (theme: ReaderTheme) => dispatch({ type: 'reader:theme', payload: { theme } }),
  fontSize: (fontSize: number) => dispatch({ type: 'reader:fontSize', payload: { fontSize } }),
  flow: (flow: ReaderFlow) => dispatch({ type: 'reader:flow', payload: { flow } }),
  goTo: (locator: string) => dispatch({ type: 'reader:goTo', payload: { locator } }),
  next: () => dispatch({ type: 'reader:next' }),
  prev: () => dispatch({ type: 'reader:prev' }),
  zoom: (scale: number) => dispatch({ type: 'reader:zoom', payload: { scale } }),
}

export function startReaderFromUrl(): void {
  const params = new URLSearchParams(location.search)
  const fixture = params.get('fixture')
  const format = params.get('format')
  if ((format === 'epub' || format === 'pdf') && fixture) {
    const url = `/fixtures/${fixture}.${format === 'epub' ? 'epub' : 'pdf'}`
    const title = params.get('title') ?? (format === 'epub' ? '红楼梦（WebView Spike）' : 'PDF 示例')
    void open({ format, url, title, theme: (params.get('theme') as ReaderTheme) ?? 'light' })
  } else {
    metaEl.textContent = '等待原生壳打开书籍'
  }
}
