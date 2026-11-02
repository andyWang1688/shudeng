import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { bridge } from './bridge'
import type {
  AnnotationPayload,
  PdfLocator,
  PdfRect,
  PdfTextItem,
  ProgressPayload,
  ReaderFlow,
  ReaderTheme,
  SelectionPayload,
} from './protocol'

GlobalWorkerOptions.workerSrc = workerSrc

const isSameRect = (a: PdfRect, b: PdfRect) =>
  Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4
  && Math.abs(a.width - b.width) < 1e-4 && Math.abs(a.height - b.height) < 1e-4

export class PdfReader {
  private document: PDFDocumentProxy | null = null
  private page = 1
  private zoom = 1
  private theme: ReaderTheme = 'light'
  private flow: ReaderFlow = 'paginated'
  private title = ''
  private pageHost: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private textLayer: HTMLElement | null = null
  private annotationLayer: HTMLElement | null = null
  private annotations = new Map<string, AnnotationPayload>()
  private textItems = new Map<number, PdfTextItem[]>()
  private renderGeneration = 0
  private url = ''
  private renderQueue = Promise.resolve()

  constructor(private host: HTMLElement, private onProgress: (payload: ProgressPayload) => void) {}

  get pageCount(): number {
    return this.document?.numPages ?? 0
  }

  async open(url: string, title: string, initialLocation?: string): Promise<void> {
    this.url = url
    this.title = title
    if (initialLocation) {
      const match = /page[:/\\]?(\\d+)/i.exec(initialLocation) ?? /^(\\d+)$/.exec(initialLocation)
      if (match) this.page = Math.max(1, Number(match[1]))
    }
    const task = getDocument({ url, useSystemFonts: true })
    this.document = await task.promise
    this.page = Math.min(Math.max(1, this.page), this.document.numPages)
    this.createPageHost()
    await this.render()
    bridge.send({
      type: 'reader:ready',
      payload: { format: 'pdf', title: this.title, totalPages: this.document.numPages, flow: this.flow },
    })
  }

  async goToPage(page: number): Promise<void> {
    if (!this.document) return
    this.page = Math.min(Math.max(1, Math.round(page)), this.document.numPages)
    this.createPageHost()
    await this.render()
    this.emitProgress()
  }

  async next(): Promise<void> {
    await this.goToPage(this.page + 1)
  }

  async prev(): Promise<void> {
    await this.goToPage(this.page - 1)
  }

  async setTheme(theme: ReaderTheme): Promise<void> {
    this.theme = theme
    this.applyTheme()
    await this.render()
  }

  async setZoom(scale: number): Promise<void> {
    this.zoom = Math.max(0.6, Math.min(3, scale))
    await this.render()
  }

  async setFlow(flow: ReaderFlow): Promise<void> {
    // PDF 的 scroll 模式仍以逐页渲染保证内存可控；此处切换后将页面容器改为可滚动纵向排列。
    this.flow = flow
    this.createPageHost()
    await this.render()
  }

  async addAnnotation(payload: AnnotationPayload): Promise<void> {
    this.annotations.set(payload.id, payload)
    this.renderAnnotations()
    this.sendAnnotationState()
  }

  clearSelection(): void {
    document.getSelection()?.removeAllRanges()
  }

  async removeAnnotation(id: string): Promise<void> {
    this.annotations.delete(id)
    this.renderAnnotations()
    this.sendAnnotationState()
  }

  currentLocation(): PdfLocator {
    return { type: 'pdf', page: this.page, text: '' }
  }

  getState(): Record<string, unknown> {
    return {
      format: 'pdf',
      title: this.title,
      flow: this.flow,
      theme: this.theme,
      zoom: this.zoom,
      page: this.page,
      totalPages: this.pageCount,
      fraction: this.fraction,
      annotationCount: this.annotations.size,
      memory: this.memorySnapshot(),
    }
  }

  getMemory(): Record<string, number> {
    return this.memorySnapshot()
  }

  /** 自动化验证：选中当前页第一段文字。 */
  selectFirstText(): SelectionPayload | null {
    if (!this.textLayer) return null
    const spans = Array.from(this.textLayer.querySelectorAll<HTMLSpanElement>('span[data-text]'))
    const span = spans.find((value) => (value.textContent ?? '').trim().length > 0)
    if (!span || !span.firstChild) return null
    const range = document.createRange()
    range.setStart(span.firstChild, 0)
    range.setEnd(span.firstChild, Math.min(span.firstChild.textContent?.length ?? 0, 30))
    const selection = document.getSelection()
    if (!selection) return null
    selection.removeAllRanges()
    selection.addRange(range)
    return this.selectionPayload(range)
  }

  /** PDF 文本坐标导出（归一化到页面 0..1），用于标注锚点/选区映射。 */
  async getTextCoordinates(pageNumber = this.page): Promise<PdfTextItem[]> {
    if (!this.document) return []
    const cached = this.textItems.get(pageNumber)
    if (cached) return cached
    const page = await this.document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const values: PdfTextItem[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str || !item.str.trim()) continue
      const tx = Util.transform(viewport.transform, item.transform)
      const fontSize = Math.hypot(tx[2], tx[3]) || item.height
      values.push({
        text: item.str,
        x: tx[4] / viewport.width,
        y: (tx[5] - fontSize) / viewport.height,
        width: (item.width || 0) / viewport.width,
        height: fontSize / viewport.height,
        fontSize,
      })
    }
    this.textItems.set(pageNumber, values)
    return values
  }

  private get fraction(): number {
    if (!this.document) return 0
    if (this.document.numPages <= 1) return 1
    return (this.page - 1) / (this.document.numPages - 1)
  }

  private createPageHost(): void {
    this.host.replaceChildren()
    this.host.dataset.flow = this.flow
    const shell = document.createElement('div')
    shell.className = 'pdf-page-shell'
    shell.style.setProperty('--reader-paper', this.theme === 'dark' ? '#191816' : '#f7f3ea')
    shell.style.setProperty('--reader-ink', this.theme === 'dark' ? '#ece5d8' : '#211e18')
    this.pageHost = shell
    this.host.append(shell)
  }

  private async render(): Promise<void> {
    if (!this.document) return
    const generation = ++this.renderGeneration
    const task = async () => {
      const page = await this.document!.getPage(this.page)
      if (generation !== this.renderGeneration) return
      const baseViewport = page.getViewport({ scale: 1 })
      const availableWidth = Math.max(320, this.host.clientWidth || 900) - 32
      const fitScale = availableWidth / baseViewport.width
      const viewport = page.getViewport({ scale: fitScale * this.zoom })
      await this.renderInto(page, viewport, generation)
    }
    this.renderQueue = this.renderQueue.then(task, task)
    await this.renderQueue
  }

  private async renderInto(page: PDFPageProxy, viewport: any, generation: number): Promise<void> {
    if (!this.pageHost) return
    this.pageHost.replaceChildren()
    this.pageHost.dataset.page = String(this.page)
    this.pageHost.style.width = `${viewport.width}px`
    this.pageHost.style.height = `${viewport.height}px`

    const canvas = document.createElement('canvas')
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(viewport.width * pixelRatio)
    canvas.height = Math.floor(viewport.height * pixelRatio)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    canvas.className = 'pdf-canvas'
    const context = canvas.getContext('2d')
    if (!context) return
    this.pageHost.append(canvas)
    this.canvas = canvas

    const textLayer = document.createElement('div')
    textLayer.className = 'pdf-text-layer'
    textLayer.setAttribute('data-page', String(this.page))
    this.pageHost.append(textLayer)
    this.textLayer = textLayer

    const annotationLayer = document.createElement('div')
    annotationLayer.className = 'pdf-annotation-layer'
    this.pageHost.append(annotationLayer)
    this.annotationLayer = annotationLayer

    this.applyTheme()
    await page.render({
      canvas,
      viewport,
      transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    }).promise
    if (generation !== this.renderGeneration) return

    const content = await page.getTextContent()
    const items: PdfTextItem[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      const tx = Util.transform(viewport.transform, item.transform)
      const fontSize = Math.hypot(tx[2], tx[3]) || item.height
      const left = tx[4]
      const top = tx[5] - fontSize
      if (!item.str.trim()) continue
      const span = document.createElement('span')
      span.dataset.text = '1'
      span.textContent = item.str
      span.style.left = `${left}px`
      span.style.top = `${top}px`
      span.style.fontSize = `${fontSize}px`
      span.style.transform = `rotate(${Math.atan2(tx[1], tx[0])}rad)`
      textLayer.append(span)
      items.push({
        text: item.str,
        x: left / viewport.width,
        y: top / viewport.height,
        width: (item.width || 0) / viewport.width,
        height: fontSize / viewport.height,
        fontSize,
      })
    }
    this.textItems.set(this.page, items)
    this.attachSelection(textLayer)
    this.renderAnnotations()
    this.emitProgress()
  }

  private attachSelection(layer: HTMLElement): void {
    if ((layer as any).__selectionBound) return
    ;(layer as any).__selectionBound = true
    let timer: number | undefined
    document.addEventListener('selectionchange', () => {
      if (!this.textLayer) return
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (!this.textLayer.contains(range.commonAncestorContainer)) return
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const payload = this.selectionPayload(range)
        if (payload) bridge.send({ type: 'reader:selection', payload })
      }, 160)
    })
  }

  private selectionPayload(range: Range): SelectionPayload {
    const text = range.toString().replace(/\s+/g, ' ').trim()
    const pageRect = this.pageHost?.getBoundingClientRect()
    const rects: PdfRect[] = []
    const screenRects: Array<{ x: number; y: number; width: number; height: number }> = []
    if (pageRect && pageRect.width > 0 && pageRect.height > 0) {
      for (const rect of Array.from(range.getClientRects())) {
        const normalized: PdfRect = {
          x: (rect.left - pageRect.left) / pageRect.width,
          y: (rect.top - pageRect.top) / pageRect.height,
          width: rect.width / pageRect.width,
          height: rect.height / pageRect.height,
        }
        if (!rects.some((value) => isSameRect(value, normalized))) rects.push(normalized)
        screenRects.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
      }
    }
    const locator: PdfLocator = { type: 'pdf', page: this.page, rects, text }
    return {
      format: 'pdf',
      text,
      locator,
      rects: screenRects,
      page: this.page,
      totalPages: this.pageCount,
    }
  }

  private emitProgress(): void {
    const payload: ProgressPayload = {
      format: 'pdf',
      fraction: this.fraction,
      locator: { type: 'pdf', page: this.page },
      page: this.page,
      totalPages: this.pageCount,
      title: this.title,
    }
    this.onProgress(payload)
  }

  private renderAnnotations(): void {
    if (!this.annotationLayer || !this.pageHost) return
    this.annotationLayer.replaceChildren()
    const pageRect = this.pageHost.getBoundingClientRect()
    if (pageRect.width === 0 || pageRect.height === 0) return
    for (const payload of this.annotations.values()) {
      if (payload.locator.type !== 'pdf' || payload.locator.page !== this.page) continue
      for (const rect of payload.locator.rects ?? []) {
        const element = document.createElement('button')
        element.className = 'pdf-annotation'
        element.type = 'button'
        element.style.left = `${rect.x * pageRect.width}px`
        element.style.top = `${rect.y * pageRect.height}px`
        element.style.width = `${rect.width * pageRect.width}px`
        element.style.height = `${rect.height * pageRect.height}px`
        element.style.background = this.annotationColor(payload.color)
        element.setAttribute('aria-label', payload.text ?? '标注')
        element.addEventListener('click', () => bridge.send({ type: 'reader:annotationSelected', payload }))
        this.annotationLayer.append(element)
      }
    }
  }

  private annotationColor(color?: string): string {
    const palette: Record<string, string> = {
      yellow: 'rgba(242, 219, 166, .45)',
      green: 'rgba(174, 208, 178, .45)',
      blue: 'rgba(170, 196, 220, .45)',
      rose: 'rgba(226, 178, 178, .45)',
    }
    return palette[color ?? 'yellow'] ?? 'rgba(242, 219, 166, .45)'
  }

  private applyTheme(): void {
    this.canvas?.classList.toggle('pdf-canvas-dark', this.theme === 'dark')
    if (this.pageHost) {
      this.pageHost.style.setProperty('--reader-paper', this.theme === 'dark' ? '#191816' : '#f7f3ea')
      this.pageHost.style.setProperty('--reader-ink', this.theme === 'dark' ? '#ece5d8' : '#211e18')
    }
  }

  private sendAnnotationState(): void {
    bridge.send({ type: 'reader:state', payload: { annotations: this.annotations.size, format: 'pdf' } })
  }

  private memorySnapshot(): Record<string, number> {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
    return memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize } : {}
  }
}
