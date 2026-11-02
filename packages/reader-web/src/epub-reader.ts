import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { bridge } from './bridge'
import type { AnnotationPayload, EpubLocator, ProgressPayload, ReaderFlow, ReaderTheme, SelectionPayload } from './protocol'

const CHAPTER_FALLBACK = '正文'

const debounce = <T extends (...args: never[]) => void>(fn: T, delay = 180) => {
  let timer: number | undefined
  return (...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), delay)
  }
}

interface FoliateView extends HTMLElement {
  book: any
  renderer: any
  lastLocation?: any
  open(book: unknown): Promise<void>
  init(options?: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>
  goTo(target: unknown): Promise<unknown>
  getCFI(index: number, range: Range): string
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range }
  addAnnotation(annotation: { value: string; [key: string]: unknown }, remove?: boolean): Promise<unknown>
  deleteAnnotation(annotation: { value: string; [key: string]: unknown }): Promise<unknown>
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
}

export class EpubReader {
  private view: FoliateView
  private title = ''
  private theme: ReaderTheme = 'light'
  private fontSize = 18
  private flow: ReaderFlow = 'paginated'
  private annotations = new Map<string, AnnotationPayload>()
  private annotationByCfi = new Map<string, AnnotationPayload>()

  private cfi(payload: AnnotationPayload): string | null {
    return payload.locator.type === 'epub' ? payload.locator.cfi : null
  }
  private lastProgress: ProgressPayload | null = null
  private userSelecting = false

  constructor(private host: HTMLElement, private onProgress: (payload: ProgressPayload) => void) {
    this.view = document.createElement('foliate-view') as FoliateView
    this.host.append(this.view)
    this.wireView()
  }

  get element(): HTMLElement {
    return this.view
  }

  async open(url: string, title: string): Promise<void> {
    this.title = title
    this.applyTheme()
    await this.view.open(url)
    await this.view.init({ showTextStart: true })
    this.applyStyles()
    this.applyFlow()
    const location = this.view.lastLocation
    if (location) {
      const payload = this.progressPayload(location)
      if (payload) this.lastProgress = payload
    }
    bridge.send({
      type: 'reader:ready',
      payload: { format: 'epub', title: this.title, flow: this.flow },
    })
  }

  async goTo(cfi: string): Promise<void> {
    const target = cfi.includes('epubcfi(') ? cfi : cfi
    await this.view.goTo(target)
  }

  async next(): Promise<void> {
    await this.view.next()
  }

  async prev(): Promise<void> {
    await this.view.prev()
  }

  async setTheme(theme: ReaderTheme): Promise<void> {
    this.theme = theme
    this.applyTheme()
    this.applyStyles()
  }

  async setFontSize(size: number): Promise<void> {
    this.fontSize = Math.max(12, Math.min(28, size))
    this.applyStyles()
  }

  async setFlow(flow: ReaderFlow): Promise<void> {
    this.flow = flow
    this.applyFlow()
  }

  async addAnnotation(payload: AnnotationPayload): Promise<void> {
    const cfi = this.cfi(payload)
    if (!cfi) return
    this.annotations.set(payload.id, payload)
    this.annotationByCfi.set(cfi, payload)
    await this.view.addAnnotation({ value: cfi, color: payload.color })
    this.sendAnnotationState()
  }

  clearSelection(): void {
    const contents = this.view.renderer?.getContents?.() ?? []
    for (const content of contents) {
      content.doc?.getSelection?.()?.removeAllRanges()
    }
  }

  async removeAnnotation(id: string): Promise<void> {
    const payload = this.annotations.get(id)
    if (!payload) return
    const cfi = this.cfi(payload)
    this.annotations.delete(id)
    if (cfi) {
      this.annotationByCfi.delete(cfi)
      await this.view.deleteAnnotation({ value: cfi })
    }
    this.sendAnnotationState()
  }

  currentLocation(): string | undefined {
    return this.lastProgress?.locator.type === 'epub' ? this.lastProgress.locator.cfi : undefined
  }

  getState(): Record<string, unknown> {
    const contents = this.view.renderer?.getContents?.() ?? []
    return {
      format: 'epub',
      title: this.title,
      flow: this.flow,
      theme: this.theme,
      fontSize: this.fontSize,
      currentCfi: this.lastProgress?.locator.type === 'epub' ? this.lastProgress.locator.cfi : null,
      fraction: this.lastProgress?.fraction ?? 0,
      chapter: this.lastProgress?.chapter ?? null,
      annotationCount: this.annotations.size,
      visibleDocuments: contents.length,
      totalPages: null,
    }
  }

  /** 自动化验证用：选中当前 iframe 第一段文字，返回选区消息。 */
  selectFirstText(): SelectionPayload | null {
    const contents = this.view.renderer?.getContents?.() ?? []
    for (const content of contents) {
      const doc: Document | undefined = content.doc
      if (!doc) continue
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      let node: Node | null
      while ((node = walker.nextNode())) {
        if (!(node.textContent ?? '').trim()) continue
        nodes.push(node as Text)
      }
      // 优先选一段正文（便于截图/标注），没有长段落才退回第一个文本节点。
      const target = nodes.find((value) => (value.textContent ?? '').trim().length >= 80) ?? nodes[0]
      if (!target) continue
      const range = doc.createRange()
      const length = Math.min(target.textContent?.length ?? 0, 60)
      if (length <= 0) continue
      range.setStart(target, 0)
      range.setEnd(target, length)
      const selection = doc.getSelection()
      if (!selection) continue
      selection.removeAllRanges()
      selection.addRange(range)
      doc.dispatchEvent(new Event('selectionchange'))
      return this.selectionPayload(content.index ?? 0, doc, range)
    }
    return null
  }

  private wireView(): void {
    this.view.addEventListener('load', (event) => {
      const detail = (event as CustomEvent<{ doc: Document; index: number }>).detail
      this.attachSelection(detail.doc, detail.index)
      for (const payload of this.annotations.values()) {
        const cfi = this.cfi(payload)
        if (cfi) void this.view.addAnnotation({ value: cfi, color: payload.color })
      }
    })

    this.view.addEventListener('relocate', (event) => {
      const detail = (event as CustomEvent<any>).detail
      const payload = this.progressPayload(detail)
      if (!payload) return
      this.lastProgress = payload
      this.onProgress(payload)
    })

    this.view.addEventListener('draw-annotation', (event) => {
      const detail = (event as CustomEvent<{ draw: (func: unknown, options: unknown) => void; annotation: { value: string; color?: string } }>).detail
      detail.draw(Overlayer.highlight, { color: detail.annotation.color ?? '#f2dba6' })
    })

    this.view.addEventListener('show-annotation', (event) => {
      const value = (event as CustomEvent<{ value: string }>).detail.value
      const payload = this.annotationByCfi.get(value)
      if (payload) bridge.send({ type: 'reader:annotationSelected', payload })
    })

    this.view.addEventListener('create-overlay', () => {
      for (const payload of this.annotations.values()) {
        const cfi = this.cfi(payload)
        if (cfi) void this.view.addAnnotation({ value: cfi, color: payload.color })
      }
    })
  }

  private attachSelection(doc: Document, index: number): void {
    doc.addEventListener('pointerdown', () => { this.userSelecting = true })
    doc.addEventListener('pointerup', () => { this.userSelecting = false })
    const handle = debounce(() => {
      const selection = doc.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      const payload = this.selectionPayload(index, doc, range)
      bridge.send({ type: 'reader:selection', payload })
    }, 160)
    doc.addEventListener('selectionchange', () => {
      if (this.userSelecting || doc.getSelection()?.type === 'Range') handle()
    })
  }

  private selectionPayload(index: number, doc: Document, range: Range): SelectionPayload {
    const text = range.toString().replace(/\s+/g, ' ').trim()
    const cfi = this.view.getCFI(index, range)
    const section = this.view.book?.sections?.[index]
    const rects = Array.from(range.getClientRects()).map((rect) => ({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }))
    const locator: EpubLocator = {
      type: 'epub',
      cfi,
      chapter: this.lastProgress?.chapter ?? CHAPTER_FALLBACK,
    }
    if (typeof section?.href === 'string') locator.href = section.href
    if (typeof this.lastProgress?.fraction === 'number') locator.fraction = this.lastProgress.fraction
    return {
      format: 'epub',
      text,
      locator,
      rects,
    }
  }

  private progressPayload(detail: any): ProgressPayload | null {
    const cfi = detail?.cfi
    if (!cfi) return null
    return {
      format: 'epub',
      fraction: typeof detail.fraction === 'number' ? detail.fraction : 0,
      locator: {
        type: 'epub',
        cfi,
        chapter: detail.tocItem?.label ?? CHAPTER_FALLBACK,
        fraction: typeof detail.fraction === 'number' ? detail.fraction : 0,
      },
      chapter: detail.tocItem?.label ?? CHAPTER_FALLBACK,
      title: this.title,
    }
  }

  private applyTheme(): void {
    this.host.style.setProperty('--reader-paper', this.theme === 'dark' ? '#191816' : '#f7f3ea')
    this.host.style.setProperty('--reader-ink', this.theme === 'dark' ? '#ece5d8' : '#211e18')
    this.host.dataset.theme = this.theme
  }

  private applyStyles(): void {
    const paper = this.theme === 'dark' ? '#191816' : '#f7f3ea'
    const ink = this.theme === 'dark' ? '#ece5d8' : '#211e18'
    const css = `
      html, body {
        background: ${paper} !important;
        color: ${ink} !important;
        font-size: ${this.fontSize}px !important;
        line-height: 1.75 !important;
      }
      a { color: ${ink} !important; }
      ::selection { background: rgba(214, 176, 94, 0.35) !important; }
    `
    this.view.renderer?.setStyles?.(css)
    this.host.style.setProperty('--reader-paper', paper)
    this.host.style.setProperty('--reader-ink', ink)
  }

  private applyFlow(): void {
    this.view.renderer?.setAttribute?.('flow', this.flow === 'scrolled' ? 'scrolled' : 'paginated')
    this.view.renderer?.setAttribute?.('margin', '28px')
    this.view.renderer?.setAttribute?.('max-column-count', '1')
  }

  private sendAnnotationState(): void {
    bridge.send({
      type: 'reader:state',
      payload: { annotations: this.annotations.size, format: 'epub' },
    })
  }
}
