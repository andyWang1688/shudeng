import 'foliate-js/view.js'
import { makeBook } from 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { EPUB } from 'foliate-js/epub.js'
import type { EpubArchiveDescriptor } from '@shudeng/core'
import { foliateResourceLoader } from './foliate-resource-loader'
import { securePublication } from './epub-sandbox'
import { bridge } from './bridge'
import type { AnnotationPayload, ContentsItem, EpubLocator, NavigationCommand, NavigationReceipt, ProgressPayload, ReaderFlow, ReaderTheme, SearchResult, SelectionPayload } from './protocol'
import type { FoliateContent, FoliateLocation, FoliateView, NavigationTarget, TocEntry } from './foliate-types'
import { epubChapterTitle, epubTarget, paintedEpubAnchor, publicationStartFraction, samePublicationHref, textRangeForQuote } from './epub-location'
import { drawNoteWave } from './note-wave'
import { readiumSelection, rangeFromReadium } from './epub-selection'
import { visibleBookmark, bookmarkRange, rangeIsVisible } from './epub-bookmarks'
import { EPUB_GUTTER, epubTypography, prepareTypographyDocument } from './epub-typography'
import { restoreTerminalLayout, stabilizeEmptyAnchorBox, stabilizeEmptyTerminalBlock, terminalRecoveryForAnchor, visibleDocumentViewport } from './epub-viewport'

export interface NativePage {
  cfi: string
  key: string
  signature: string
  fraction: number
  canPrevious: boolean
  canNext: boolean
  progress: ProgressPayload
}

export interface EpubOpenOptions {
  theme?: ReaderTheme
  fontSize?: number
  flow?: ReaderFlow
}

const debounce = <T extends (...args: never[]) => void>(fn: T, delay = 180) => {
  let timer: number | undefined
  return (...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), delay)
  }
}

export class EpubReader {
  private view: FoliateView
  private title = ''
  private theme: ReaderTheme = 'light'
  private fontSize = 18.5
  private flow: ReaderFlow = 'paginated'
  private annotations = new Map<string, AnnotationPayload>()
  private annotationByCfi = new Map<string, AnnotationPayload>()

  private cfi(payload: AnnotationPayload): string | null {
    return payload.locator.type === 'epub' ? payload.locator.cfi : null
  }
  private annotationForCfi(cfi: string): AnnotationPayload | undefined {
    const items = Array.from(this.annotations.values()).filter(item => this.cfi(item) === cfi)
    return items.find(item => item.note) ?? items.at(-1)
  }
  private lastProgress: ProgressPayload | null = null
  private userSelecting = false
  private selectionActionsEnabled = true
  private searchGeneration = 0
  private startFraction: number | null = null
  private nativeCurl = false
  private nativeOriginal: NativePage | null = null
  private nativePreparing = false
  private nativeRecoveryPending = false
  private resources: ReturnType<typeof foliateResourceLoader> | null = null
  private citationCfi: string | null = null
  private readonly citationKey = '__question-citation'
  private terminalRecovery: HTMLElement | null = null
  private readonly resize: ResizeObserver
  private scrollRevision = 0

  constructor(private host: HTMLElement, private onProgress: (payload: ProgressPayload) => void) {
    this.view = document.createElement('foliate-view') as FoliateView
    this.host.append(this.view)
    this.wireView()
    this.resize = new ResizeObserver(() => this.applyGutter())
    this.resize.observe(this.host)
  }

  destroy(): void {
    this.scrollRevision += 1
    this.resize.disconnect()
    this.searchGeneration += 1
    this.clearTerminalRecovery()
    for (const content of this.view.renderer?.getContents?.() ?? []) restoreTerminalLayout(content.doc)
    const publication = this.view.book
    try { this.view.close() }
    finally {
      try { publication?.destroy?.() }
      finally { this.resources?.close(); this.resources = null }
    }
  }

  get element(): HTMLElement {
    return this.view
  }

  async open(source: string | Blob | EpubArchiveDescriptor, title: string, options: EpubOpenOptions = {}): Promise<void> {
    this.title = title
    this.theme = options.theme ?? this.theme
    this.fontSize = Math.max(13.875, Math.min(37, options.fontSize ?? this.fontSize))
    this.flow = options.flow ?? this.flow
    this.applyTheme()
    if (typeof source === 'object' && !(source instanceof Blob)) {
      this.resources = foliateResourceLoader(source)
      // Passing a resource URL to makeBook would recreate a complete File/Blob.
      const book = await new EPUB(this.resources).init() as NonNullable<FoliateView['book']>
      securePublication(book)
      await this.view.open(book)
    } else {
      const book = await makeBook(source) as NonNullable<FoliateView['book']>
      securePublication(book)
      await this.view.open(book)
    }
    // Capture runs before Foliate's load listener fills html.lang, so an authored
    // body language can take priority over the publication's default language.
    this.view.renderer?.addEventListener('load', event => {
      const detail = (event as CustomEvent<{ doc: Document }>).detail
      const restoreLanguage = prepareTypographyDocument(detail.doc, this.view.book?.metadata?.language)
      if (restoreLanguage) this.view.addEventListener('load', restoreLanguage, { once: true })
    }, { capture: true })
    this.view.renderer?.addEventListener('relocate', event => {
      const detail = (event as CustomEvent<{ index: number; fraction: number }>).detail
      this.startFraction = publicationStartFraction(this.view.book?.sections ?? [], detail.index, detail.fraction)
    }, { capture: true })
    // Foliate captures each document's background during its first layout.
    this.applyStyles()
    this.applyFlow()
    await this.view.init({ showTextStart: true })
    const location = this.view.lastLocation
    if (location) {
      const payload = this.progressPayload(location)
      if (payload) this.lastProgress = payload
    }
  }

  private async resolveLocation(value: string, quote?: string): Promise<NavigationTarget> {
    const target = epubTarget(value, quote)
    if (target.cfi?.startsWith('epubcfi(')) {
      const resolved = this.view.resolveCFI(target.cfi)
      const anchor = resolved.anchor
      return typeof anchor === 'function'
        ? { ...resolved, anchor: doc => paintedEpubAnchor(anchor(doc)) }
        : resolved
    }
    const href = target.href ?? target.cfi
    if (!href) throw new Error('没有可用的原文位置')
    const sections = this.view.book?.sections ?? []
    const index = sections.findIndex(section => samePublicationHref(section.href ?? section.id ?? '', href))
    const resolved = this.view.book?.resolveHref?.(href)
    const sectionIndex = index >= 0 ? index : resolved?.index
    if (sectionIndex === undefined || !sections[sectionIndex]) throw new Error('未找到这条记录对应的章节')
    const section = sections[sectionIndex]!
    if (target.quote && section.createDocument) {
      const doc = await section.createDocument()
      const exact = rangeFromReadium(doc, target.domRange)
      const range = exact && exact.toString() === target.quote ? exact : textRangeForQuote(doc, target.quote, target)
      if (range) return this.view.resolveCFI(this.view.getCFI(sectionIndex, range))
      // A quoted reference must never silently navigate to a different passage.
      throw new Error('未找到这段原文，记录的位置没有改变')
    }
    if (target.selector) return { index: sectionIndex, anchor: doc => doc.querySelector(target.selector!) ?? doc.body }
    if (target.progression !== undefined) return { index: sectionIndex, anchor: target.progression }
    return resolved ?? { index: sectionIndex }
  }

  private async prepareTargetLayout(target: NavigationTarget): Promise<NavigationTarget> {
    const renderer = this.view.renderer
    if (this.flow === 'scrolled' || !renderer || typeof target.anchor !== 'function') return target
    const content = this.targetContent(target)
    if (!content?.doc) return target
    const anchor = target.anchor
    const fallbackHeight = renderer.getBoundingClientRect().height || this.host.getBoundingClientRect().height
    let stabilized = stabilizeEmptyTerminalBlock(content.doc, fallbackHeight)
    const guardedAnchor = (doc: Document) => {
      const value = anchor(doc)
      if (this.flow !== 'scrolled') stabilized = stabilizeEmptyAnchorBox(value, doc, fallbackHeight) || stabilized
      return value
    }
    guardedAnchor(content.doc)
    if (stabilized) {
      renderer.render?.()
      const view = content.doc.defaultView
      await new Promise<void>(resolve => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        if (typeof view?.requestAnimationFrame === 'function') {
          view.requestAnimationFrame(() => view.requestAnimationFrame(finish))
        }
        setTimeout(finish, 250)
      })
    }
    return { ...target, anchor: guardedAnchor }
  }

  private clearTerminalRecovery(): void {
    this.terminalRecovery?.remove()
    this.terminalRecovery = null
  }

  private async recoverUnpaintedTarget(target: NavigationTarget): Promise<void> {
    if (this.flow === 'scrolled' || typeof target.anchor !== 'function') return
    const revision = this.scrollRevision
    const content = this.targetContent(target)
    if (!content?.doc) return
    await new Promise<void>(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      requestAnimationFrame(() => requestAnimationFrame(finish))
      setTimeout(finish, 150)
    })
    if (revision !== this.scrollRevision) return
    let anchor: Range | Element | number
    try {
      anchor = target.anchor(content.doc)
    } catch {
      return
    }
    const recovery = terminalRecoveryForAnchor(anchor)
    if (!recovery) return

    const page = document.createElement('section')
    page.className = 'reader-terminal-recovery'
    page.dataset.readerTerminalRecovery = ''
    page.style.fontSize = `${this.fontSize}px`
    const body = document.createElement('div')
    body.className = 'reader-terminal-recovery-body'
    for (const block of recovery.blocks) {
      const paragraph = document.createElement('p')
      const matchAt = block.target && recovery.match ? block.text.indexOf(recovery.match) : -1
      if (matchAt < 0) {
        paragraph.textContent = block.text
      } else {
        paragraph.append(block.text.slice(0, matchAt))
        const mark = document.createElement('mark')
        mark.textContent = recovery.match
        paragraph.append(mark, block.text.slice(matchAt + recovery.match.length))
      }
      body.append(paragraph)
    }
    page.append(body)
    this.host.append(page)
    this.terminalRecovery = page
  }

  async goTo(value: string): Promise<void> {
    this.scrollRevision += 1
    if (!this.view.renderer) throw new Error('阅读器尚未准备好')
    this.clearTerminalRecovery()
    const target = await this.prepareTargetLayout(await this.resolveLocation(value))
    await this.view.renderer.goTo(target)
    await this.recoverUnpaintedTarget(target)
  }

  async navigateReference(command: NavigationCommand): Promise<NavigationReceipt> {
    this.scrollRevision += 1
    try {
      this.clearTerminalRecovery()
      this.clearSelection()
      this.citationCfi = null
      this.drawCitation()
      let target = await this.resolveLocation(command.locator, command.citation?.quote)
      let citation: string | null = null
      if (command.citation?.quote) {
        const section = this.view.book?.sections?.[target.index]
        const doc = await section?.createDocument?.()
        if (!doc) throw new Error('这条引用没有可确认的原文')
        const anchored = typeof target.anchor === 'function' ? target.anchor(doc) : null
        const quote = command.citation.quote
        const exact = anchored instanceof Range && anchored.toString().replace(/\s+/g, ' ').trim() === quote.replace(/\s+/g, ' ').trim() ? anchored : null
        const range = exact ?? textRangeForQuote(doc, quote, epubTarget(command.locator, quote))
        if (!range) throw new Error('未找到这段引用，原阅读位置没有改变')
        citation = this.view.getCFI(target.index, range)
        target = this.view.resolveCFI(citation)
      }
      if (!this.view.renderer) throw new Error('阅读器尚未准备好')
      target = await this.prepareTargetLayout(target)
      await this.view.renderer.goTo(target)
      await this.waitForPaint()
      this.citationCfi = citation
      this.drawCitation()
      await this.recoverUnpaintedTarget(target)
      await this.waitForPaint()
      return { operationId: command.operationId, status: 'arrived', ...(this.lastProgress ? { progress: this.lastProgress } : {}) }
    } catch (cause) {
      return { operationId: command.operationId, status: 'failed', message: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  private drawCitation(): void {
    for (const content of this.view.renderer?.getContents?.() ?? []) {
      content.overlayer?.remove(this.citationKey)
    }
    if (!this.citationCfi) return
    const target = this.view.resolveCFI(this.citationCfi)
    const content = this.targetContent(target)
    if (!content || typeof target.anchor !== 'function') return
    const range = target.anchor(content.doc)
    // Range comes from the publication iframe's realm.
    if (range && typeof range !== 'number' && 'startContainer' in range) content.overlayer?.add(this.citationKey, range, Overlayer.highlight, { color: this.theme === 'dark' ? '#5A4A2A' : '#F2DBA6' })
  }

  async next(): Promise<void> {
    this.clearTerminalRecovery()
    await this.view.next()
  }

  async prev(): Promise<void> {
    this.clearTerminalRecovery()
    await this.view.prev()
  }

  /** Native owns only the curl presentation. Foliate remains the only pagination/locator authority. */
  setNativeCurl(enabled: boolean): void {
    this.nativeCurl = enabled
  }

  private pageIdentity(): string {
    const renderer = this.view.renderer
    const key = renderer?.getPageTurnKey?.()
    if (key) return key
    const index = this.currentContent()?.index ?? -1
    const cfi = this.view.lastLocation?.cfi ?? this.currentLocation() ?? ''
    return `${index}:${renderer?.page ?? -1}:${renderer?.pages ?? -1}:${cfi}`
  }

  private visibleContents(): FoliateContent[] {
    return (this.view.renderer?.getContents?.() ?? []).filter(({ doc }) => {
      const viewport = visibleDocumentViewport(doc, this.host)
      return !viewport || (viewport.left < viewport.right && viewport.top < viewport.bottom)
    })
  }

  private currentContent(): FoliateContent | undefined {
    const contents = this.visibleContents()
    const doc = this.view.lastLocation?.range?.startContainer?.ownerDocument
    const located = contents.find(content => content.doc === doc)
    if (located) return located
    const cfi = this.view.lastLocation?.cfi
    if (cfi) {
      const content = this.targetContent(this.view.resolveCFI(cfi), contents)
      if (content) return content
    }
    return contents.find(content => content.index === this.view.renderer?.primaryIndex) ?? contents[0]
  }

  /** A spine can have several live chunks with placeholder copies of its DOM. */
  private targetContent(target: NavigationTarget, contents = this.view.renderer?.getContents?.() ?? []): FoliateContent | undefined {
    const candidates = contents.filter(content => content.index === target.index)
    if (typeof target.anchor !== 'function') return candidates[0]
    const anchor = target.anchor
    return candidates.find(({ doc }) => {
      try {
        const value = anchor(doc)
        if (!value || typeof value === 'number') return false
        const node = 'startContainer' in value ? value.startContainer : value
        const element = node.nodeType === 1 ? node as Element : node.parentElement
        return !!element && !element.closest?.('[data-foliate-chunk]')
      } catch { return false }
    })
  }

  private chapterFor(index: number, range?: Range): string {
    if (this.isChunkedRange(range)) return this.title
    const label = this.view.getProgressOf?.(index, range).tocItem?.label
    if (label?.trim()) return epubChapterTitle(this.title, label)
    if (this.view.lastLocation?.section?.current === index) return this.lastProgress?.chapter ?? this.title
    const href = this.view.book?.sections?.[index]?.id
    const find = (items: TocEntry[]): string | undefined => {
      for (const item of items) {
        const nested = find(item.subitems ?? [])
        if (nested) return nested
        if (href && item.href && samePublicationHref(item.href, href)) return item.label
      }
      return undefined
    }
    return epubChapterTitle(this.title, find(this.view.book?.toc ?? []))
  }

  private isChunkedRange(range?: Range): boolean {
    // Missing fragment IDs in chunk placeholders confuse upstream TOCProgress.
    // Keep the exact CFI, but never persist an unrelated chapter's title.
    return !!range?.startContainer?.ownerDocument?.querySelector?.('[data-foliate-chunk]')
  }

  private async waitForPaint(): Promise<void> {
    const contents = this.visibleContents()
    const deadline = <T>(operation: Promise<T>, label: string): Promise<T> => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label)), 8000)
      operation.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
    })
    await Promise.all(contents.map(async ({ doc }) => {
      await deadline(doc.fonts.ready, '字体尚未完成，未生成卷页快照')
      await Promise.all(Array.from(doc.images).map(image => image.complete ? Promise.resolve() : deadline(new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      }), '图片尚未完成，未生成卷页快照')))
    }))
    const painted = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    let previous = ''
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await deadline(painted(), '页面未完成绘制，未生成卷页快照')
      const current = this.pageIdentity() + '|' + (this.view.lastLocation?.cfi ?? '')
      if (previous === current && this.view.lastLocation?.cfi) return
      previous = current
    }
    throw new Error('页面仍在排版，未生成卷页快照')
  }

  async nativePage(): Promise<NativePage> {
    await this.waitForPaint()
    const cfi = this.currentLocation()
    if (!cfi || !this.lastProgress) throw new Error('没有可确认的当前页')
    const contents = this.view.renderer?.getContents?.() ?? []
    if (this.view.resolveCFI(cfi).index !== this.currentContent()?.index) throw new Error('原文位置尚未到达当前章节，未生成卷页快照')
    const range = this.view.lastLocation?.range
    let signature = range?.toString().replace(/\s+/g, ' ').trim().slice(0, 180) ?? ''
    if (!signature) {
      const host = this.host.getBoundingClientRect()
      signature = contents.flatMap(({ doc, index }) => {
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
        return Array.from(doc.querySelectorAll('img,svg,video,canvas')).flatMap((element, ordinal) => {
          const rect = element.getBoundingClientRect()
          const left = rect.left + (frame?.left ?? 0), top = rect.top + (frame?.top ?? 0)
          if (rect.width <= 0 || rect.height <= 0 || left >= host.right || left + rect.width <= host.left || top >= host.bottom || top + rect.height <= host.top) return []
          return [`media:${index}:${ordinal}:${element.localName}:${[left - host.left, top - host.top, rect.width, rect.height].map(value => Math.round(value * 100) / 100).join(',')}`]
        })
      }).join('|')
    }
    return {
      cfi, key: this.pageIdentity(), signature,
      fraction: this.lastProgress?.fraction ?? 0,
      canPrevious: this.view.renderer?.atStart !== true, canNext: this.view.renderer?.atEnd !== true,
      progress: this.lastProgress,
    }
  }

  async beginNativePreparation(): Promise<NativePage> {
    if (this.nativePreparing || (this.nativeOriginal && !this.nativeRecoveryPending)) throw new Error('卷页准备尚未结束')
    if ((this.view.renderer?.getContents?.() ?? []).some(({ doc }) => doc.getSelection()?.toString().trim())) throw new Error('选文期间不准备卷页')
    if (this.nativeRecoveryPending) await this.abortNativePreparation()
    this.nativePreparing = true
    try {
      this.nativeOriginal = await this.nativePage()
      return this.nativeOriginal
    } catch (error) {
      this.nativePreparing = false
      throw error
    }
  }

  async nativeStep(direction: number): Promise<NativePage | null> {
    if (this.nativeRecoveryPending) throw new Error('卷页原文尚未恢复，请先重试恢复原文位置')
    if (!this.nativeOriginal) throw new Error('卷页准备事务未开始')
    const before = await this.nativePage()
    if (direction < 0 ? !before.canPrevious : !before.canNext) return null
    await (direction < 0 ? this.prev() : this.next())
    const after = await this.nativePage()
    if (before.key === after.key) throw new Error('翻页未到达目标，未更新阅读位置')
    return after
  }

  async nativeRestore(page: NativePage): Promise<NativePage> {
    if (!this.nativeOriginal) throw new Error('卷页准备事务未开始')
    await this.goTo(page.cfi)
    const actual = await this.nativePage()
    if (actual.key !== page.key || actual.signature !== page.signature) throw new Error('卷页原文位置校验失败，阅读位置未保存')
    return actual
  }

  async finishNativePreparation(commit: boolean): Promise<NativePage> {
    if (this.nativeRecoveryPending) throw new Error('卷页原文尚未恢复，请先重试恢复原文位置')
    if (!this.nativeOriginal) throw new Error('卷页准备事务未开始')
    const original = this.nativeOriginal
    if (!commit) await this.nativeRestore(original)
    const page = await this.nativePage()
    this.nativeOriginal = null
    this.nativePreparing = false
    if (commit && this.lastProgress) this.onProgress(this.lastProgress)
    return page
  }

  /** A real viewport reflow invalidates page numbers, but must keep the original text anchor. */
  async abortNativePreparation(target?: NativePage): Promise<void> {
    const retained = target ?? this.nativeOriginal
    this.nativePreparing = true
    this.nativeOriginal = retained
    try {
      if (retained) await this.goTo(retained.cfi)
      await this.waitForPaint()
      this.nativeOriginal = null
      this.nativeRecoveryPending = false
    } catch (error) {
      // Retire active preparation without losing the original recovery intent.
      // No temporary page may publish progress or commit before recovery.
      this.nativeRecoveryPending = retained !== null
      throw error
    } finally {
      this.nativePreparing = false
    }
  }

  async setTheme(theme: ReaderTheme): Promise<void> {
    if (this.theme === theme) return
    this.theme = theme
    this.applyTheme()
    this.applyStyles()
    this.drawCitation()
    for (const cfi of this.annotationByCfi.keys()) await this.view.addAnnotation({ value: cfi })
  }

  async setFontSize(size: number): Promise<void> {
    const fontSize = Math.max(13.875, Math.min(37, size))
    if (this.fontSize === fontSize) return
    this.fontSize = fontSize
    const location = this.currentLocation()
    this.applyStyles()
    if (location) await this.goTo(location)
  }

  async setFlow(flow: ReaderFlow): Promise<void> {
    if (this.flow === flow) return
    const location = this.currentLocation()
    this.flow = flow
    this.applyFlow()
    if (location) await this.goTo(location)
  }

  contents(): ContentsItem[] {
    const items: ContentsItem[] = []
    const visit = (entries: TocEntry[], depth: number) => {
      for (const entry of entries) {
        if (entry.href) items.push({ label: entry.label ?? '正文', href: entry.href, depth })
        if (entry.subitems) visit(entry.subitems, depth + 1)
      }
    }
    visit(this.view.book?.toc ?? [], 0)
    return items
  }

  async search(query: string, requestId: number): Promise<void> {
    const generation = ++this.searchGeneration
    this.view.clearSearch()
    const items: SearchResult[] = []
    if (!query.trim()) {
      bridge.send({ type: 'reader:searchResults', payload: { requestId, items, done: true } })
      return
    }
    try {
      for await (const result of this.view.search({ query: query.trim() })) {
        if (generation !== this.searchGeneration) return
        if (result === 'done') break
        for (const item of result.subitems ?? (result.cfi ? [result] : [])) {
          if (!item.cfi) continue
          const excerpt = item.excerpt
          items.push({ label: result.label ?? '正文', excerpt: excerpt ? excerpt.pre + excerpt.match + excerpt.post : query, locator: item.cfi })
        }
        bridge.send({ type: 'reader:searchResults', payload: { requestId, items: items.slice(0, 500), done: false } })
        if (items.length >= 500) break
      }
      if (generation === this.searchGeneration) bridge.send({ type: 'reader:searchResults', payload: { requestId, items: items.slice(0, 500), done: true } })
    } catch (error) {
      if (generation === this.searchGeneration) bridge.send({ type: 'reader:searchResults', payload: { requestId, items, done: true, error: error instanceof Error ? error.message : String(error) } })
    }
  }

  async addAnnotation(payload: AnnotationPayload): Promise<void> {
    let cfi = this.cfi(payload)
    if (!cfi) return
    if (!cfi.startsWith('epubcfi(')) {
      const resolved = await this.resolveLocation(JSON.stringify(payload.locator), payload.text)
      const doc = await this.view.book?.sections?.[resolved.index]?.createDocument?.()
      const range = doc && typeof resolved.anchor === 'function' ? resolved.anchor(doc) : null
      if (!(range instanceof Range)) throw new Error('标注没有可确认的原文范围')
      cfi = this.view.getCFI(resolved.index, range)
    }
    const previous = this.annotations.get(payload.id)
    const previousCfi = previous && this.cfi(previous)
    if (previousCfi && previousCfi !== cfi) await this.view.deleteAnnotation({ value: previousCfi })
    payload = { ...payload, locator: { ...payload.locator, type: 'epub', cfi } }
    this.annotations.set(payload.id, payload)
    this.annotationByCfi.set(cfi, this.annotationForCfi(cfi) ?? payload)
    await this.view.addAnnotation({ value: cfi, color: payload.color })
    bridge.send({ type: 'reader:annotation', payload })
    this.sendAnnotationState()
  }

  clearSelection(): void {
    const contents = this.view.renderer?.getContents?.() ?? []
    for (const content of contents) {
      content.doc?.getSelection?.()?.removeAllRanges()
    }
  }

  setSelectionActionsEnabled(enabled: boolean): void {
    const wasEnabled = this.selectionActionsEnabled
    this.selectionActionsEnabled = enabled
    if (wasEnabled && !enabled) {
      this.userSelecting = false
      this.clearSelection()
      bridge.send({ type: 'reader:selectionCleared' })
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
      const remaining = this.annotationForCfi(cfi)
      if (remaining) {
        this.annotationByCfi.set(cfi, remaining)
        await this.view.addAnnotation({ value: cfi, color: remaining.color })
      }
    }
    bridge.send({ type: 'reader:annotation', payload })
    this.sendAnnotationState()
  }

  bookmarkContext(bookmarks: ReadonlyArray<{ id: string; locator: EpubLocator }>, requestId: number, captureLocation = true): void {
    const contents = this.view.renderer?.getContents?.() ?? []
    let locator: EpubLocator | null = null
    let quote = ''
    const visibleIds = new Set<string>()
    for (const content of contents) {
      const href = this.view.book?.sections?.[content.index]?.id ?? ''
      const viewport = visibleDocumentViewport(content.doc, this.host)
      if (viewport && (viewport.left >= viewport.right || viewport.top >= viewport.bottom)) continue
      if (captureLocation && !locator) {
        const capture = visibleBookmark(content.doc, href, viewport)
        if (capture) {
          locator = { type: 'epub', cfi: this.view.getCFI(content.index, capture.range), href, selection: capture.selection, chapter: this.chapterFor(content.index, capture.range), ...(this.lastProgress?.fraction === undefined ? {} : { fraction: this.lastProgress.fraction }) }
          quote = capture.selection.text?.highlight ?? ''
        }
      }
      for (const bookmark of bookmarks) {
        if (bookmark.locator.href && !samePublicationHref(bookmark.locator.href, href)) continue
        let range = bookmarkRange(content.doc, bookmark.locator)
        if (!range && bookmark.locator.cfi.startsWith('epubcfi(')) {
          try {
            const target = this.view.resolveCFI(bookmark.locator.cfi)
            const anchor = target.index === content.index && typeof target.anchor === 'function' ? target.anchor(content.doc) : null
            if (anchor && typeof anchor !== 'number' && 'startContainer' in anchor) range = anchor
          } catch { /* An invalid old bookmark remains in the list but is not marked visible. */ }
        }
        if (range && rangeIsVisible(content.doc, range, viewport)) visibleIds.add(bookmark.id)
      }
    }
    bridge.send({ type: 'reader:bookmark-context', payload: { requestId, locator, quote, visibleIds: [...visibleIds] } })
  }

  currentLocation(): string | undefined {
    return this.lastProgress?.locator.type === 'epub' ? this.lastProgress.locator.cfi : undefined
  }

  getState(): Record<string, unknown> {
    const contents = this.visibleContents()
    return {
      format: 'epub',
      title: this.title,
      flow: this.flow,
      theme: this.theme,
      fontSize: this.fontSize,
      currentCfi: this.lastProgress?.locator.type === 'epub' ? this.lastProgress.locator.cfi : null,
      fraction: this.lastProgress?.fraction ?? 0,
      chapter: this.lastProgress?.chapter ?? null,
      selectionActionsEnabled: this.selectionActionsEnabled,
      annotationCount: this.annotations.size,
      visibleDocuments: contents.length,
      totalPages: null,
      nativeRecoveryPending: this.nativeRecoveryPending,
      viewport: this.view.renderer?.getViewportState?.() ?? null,
    }
  }

  /** 自动化验证用：选中当前 iframe 第一段文字，返回选区消息。 */
  selectFirstText(): SelectionPayload | null {
    if (!this.selectionActionsEnabled) return null
    const contents = this.visibleContents()
    for (const content of contents) {
      const doc: Document | undefined = content.doc
      if (!doc) continue
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      const viewport = visibleDocumentViewport(doc, this.host)
      let node: Node | null
      while ((node = walker.nextNode())) {
        if (!(node.textContent ?? '').trim()) continue
        if (node.parentElement?.closest?.('[data-foliate-chunk]')) continue
        const candidate = doc.createRange()
        candidate.setStart(node, 0)
        candidate.setEnd(node, Math.min(node.textContent?.length ?? 0, 60))
        if (!rangeIsVisible(doc, candidate, viewport)) continue
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
      const detail = (event as CustomEvent<FoliateLocation>).detail
      const payload = this.progressPayload(detail)
      if (!payload) return
      this.lastProgress = payload
      if (!this.nativeOriginal && !this.nativePreparing) this.onProgress(payload)
    })

    this.view.addEventListener('draw-annotation', (event) => {
      const detail = (event as CustomEvent<{ draw: (func: unknown, options: unknown) => void; annotation: { value: string; color?: string } }>).detail
      const payload = this.annotationByCfi.get(detail.annotation.value)
      const colors: Record<string, string> = this.theme === 'dark'
        ? { yellow: '#5A4A2A', green: '#30402C', blue: '#2C3A44', rose: '#472F2C', pink: '#472F2C' }
        : { yellow: '#F2DBA6', green: '#DEE8D3', blue: '#DCE6EC', rose: '#F3DEDA', pink: '#F3DEDA' }
      const color = payload?.note ? (this.theme === 'dark' ? '#F0C98B' : '#8A5413') : colors[payload?.color ?? 'yellow'] ?? payload?.color ?? '#F2DBA6'
      detail.draw(payload?.note ? drawNoteWave : Overlayer.highlight, { color })
    })

    this.view.addEventListener('show-annotation', (event) => {
      const value = (event as CustomEvent<{ value: string }>).detail.value
      const payload = this.annotationByCfi.get(value)
      if (payload) bridge.send({ type: 'reader:annotationSelected', payload })
    })

    this.view.addEventListener('create-overlay', () => {
      queueMicrotask(() => this.drawCitation())
      for (const payload of this.annotations.values()) {
        const cfi = this.cfi(payload)
        if (cfi) void this.view.addAnnotation({ value: cfi, color: payload.color })
      }
    })
  }

  private attachSelection(doc: Document, index: number): void {
    // UIKit owns the drag in curl mode; keep WebKit's text-selection defaults.
    for (const type of ['touchstart', 'touchmove', 'touchend']) doc.addEventListener(type, event => {
      if (this.nativeCurl && !doc.getSelection()?.toString().trim()) event.stopImmediatePropagation()
    }, { capture: true, passive: true })
    let pointer: { x: number; y: number } | null = null
    doc.addEventListener('pointerdown', event => { pointer = { x: event.clientX, y: event.clientY } })
    doc.addEventListener('pointerup', event => {
      if (!pointer || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) return
      if (doc.getSelection()?.toString().trim() || (event.target as Element | null)?.closest('a,button,input,textarea')) return
      const content = this.view.renderer?.getContents?.().find(content => content.doc === doc)
      if (content?.overlayer?.hitTest({ x: event.clientX, y: event.clientY })[0]) return
      if (this.flow === 'scrolled') { bridge.send({ type: 'reader:tap' }); return }
      const viewport = visibleDocumentViewport(doc, this.host)
      const width = viewport ? viewport.right - viewport.left : doc.defaultView?.innerWidth ?? 0
      const x = event.clientX - (viewport?.left ?? 0)
      if (width > 0 && x < width * .3) {
        if (this.nativeCurl) bridge.send({ type: 'reader:turnRequested', payload: { direction: -1 } })
        else void this.prev()
      } else if (width > 0 && x > width * .7) {
        if (this.nativeCurl) bridge.send({ type: 'reader:turnRequested', payload: { direction: 1 } })
        else void this.next()
      }
      else bridge.send({ type: 'reader:tap' })
    })
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
      if (!doc.getSelection()?.toString().trim()) { bridge.send({ type: 'reader:selectionCleared' }); return }
      if (this.userSelecting || doc.getSelection()?.type === 'Range') handle()
    })
  }

  private selectionPayload(index: number, doc: Document, range: Range): SelectionPayload {
    const text = range.toString().replace(/\s+/g, ' ').trim()
    const cfi = this.view.getCFI(index, range)
    const section = this.view.book?.sections?.[index]
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
    const rects = Array.from(range.getClientRects()).map((rect) => ({
      x: rect.left + (frame?.left ?? 0),
      y: rect.top + (frame?.top ?? 0),
      width: rect.width,
      height: rect.height,
    }))
    const locator: EpubLocator = {
      type: 'epub',
      cfi,
      chapter: this.chapterFor(index, range),
    }
    const href = section?.href ?? section?.id
    if (typeof href === 'string') { locator.href = href; locator.selection = readiumSelection(href, doc, range) }
    if (typeof this.lastProgress?.fraction === 'number') locator.fraction = this.lastProgress.fraction
    return {
      format: 'epub',
      text,
      locator,
      rects,
    }
  }

  private progressPayload(detail: FoliateLocation): ProgressPayload | null {
    const cfi = detail?.cfi
    if (!cfi) return null
    const chapter = this.isChunkedRange(detail.range) ? this.title
      : epubChapterTitle(this.title, detail.tocItem?.label, this.nativeOriginal?.progress.chapter ?? this.lastProgress?.chapter)
    return {
      format: 'epub',
      fraction: this.startFraction ?? (typeof detail.fraction === 'number' ? detail.fraction : 0),
      locator: {
        type: 'epub',
        cfi,
        chapter,
        fraction: this.startFraction ?? (typeof detail.fraction === 'number' ? detail.fraction : 0),
        href: this.view.book?.sections?.[detail.section?.current ?? 0]?.id ?? '',
      },
      chapter,
      title: this.title,
    }
  }

  private applyTheme(): void {
    this.host.style.setProperty('--reader-paper', this.theme === 'dark' ? '#1B1A17' : '#FAF7F1')
    this.host.style.setProperty('--reader-ink', this.theme === 'dark' ? '#F3EEE3' : '#211E18')
    this.host.dataset.theme = this.theme
  }

  private applyStyles(): void {
    this.scrollRevision += 1
    const paper = this.theme === 'dark' ? '#1B1A17' : '#FAF7F1'
    const ink = this.theme === 'dark' ? '#F3EEE3' : '#211E18'
    this.view.renderer?.setStyles?.(epubTypography(this.fontSize, this.theme, { language: this.view.book?.metadata?.language, dir: this.view.book?.dir }))
    // Keep the renderer canvas themed through reflow and adjacent loads.
    if (this.view.renderer) this.view.renderer.style.background = paper
    this.host.style.setProperty('--reader-paper', paper)
    this.host.style.setProperty('--reader-ink', ink)
  }

  private applyFlow(): void {
    this.scrollRevision += 1
    this.clearTerminalRecovery()
    for (const content of this.view.renderer?.getContents?.() ?? []) restoreTerminalLayout(content.doc)
    const renderer = this.view.renderer
    const attributes = { flow: this.flow === 'scrolled' ? 'scrolled' : 'paginated', 'margin-top': EPUB_GUTTER + 'px', 'margin-bottom': EPUB_GUTTER + 'px', 'margin-left': EPUB_GUTTER + 'px', 'margin-right': EPUB_GUTTER + 'px', 'max-column-count': '1' }
    for (const [name, value] of Object.entries(attributes)) {
      if (renderer?.getAttribute(name) !== value) renderer?.setAttribute(name, value)
    }
    this.applyGutter()
  }

  private applyGutter(): void {
    const width = this.host.getBoundingClientRect().width
    if (width <= 0) return
    // Foliate expresses the total outside gutter as a percentage of its width.
    // Keep 28px through rotation instead of its default width-dependent 7%.
    // Scrolled columns use the full host width; paginated columns have already
    // removed the outside gutter before Foliate resolves its inner gap.
    const gap = String(EPUB_GUTTER / (this.flow === 'scrolled' ? width + EPUB_GUTTER : width) * 100) + '%'
    if (this.view.renderer?.getAttribute('gap') !== gap) this.view.renderer?.setAttribute('gap', gap)
  }

  private sendAnnotationState(): void {
    bridge.send({
      type: 'reader:state',
      payload: { annotations: this.annotations.size, format: 'epub' },
    })
  }
}
