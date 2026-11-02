export type ReaderFormat = 'epub' | 'pdf'
export type ReaderTheme = 'light' | 'dark'
export type ReaderFlow = 'paginated' | 'scrolled'

/** 标注锚点：EPUB 用 CFI；PDF 用页码 + 页面归一化矩形。 */
export interface EpubLocator {
  type: 'epub'
  cfi: string
  href?: string
  chapter?: string
  fraction?: number
}

export interface PdfLocator {
  type: 'pdf'
  page: number
  rects?: PdfRect[]
  text?: string
}

export interface PdfRect {
  /** 页面左上角归一化坐标，0..1。 */
  x: number
  y: number
  width: number
  height: number
}

export type ReaderLocator = EpubLocator | PdfLocator

export interface OpenPayload {
  format: ReaderFormat
  url: string
  /** 原生 WebView 打包场景：直接传 fixture 的 base64 内容，避免 file:// 资源加载。 */
  dataBase64?: string
  mimeType?: string
  title?: string
  initialLocation?: string
  theme?: ReaderTheme
  fontSize?: number
  flow?: ReaderFlow
}

export interface SelectionPayload {
  format: ReaderFormat
  text: string
  locator: ReaderLocator
  /** 选区在阅读器视口内的矩形（屏幕坐标，可用于原生浮层定位）。 */
  rects?: Array<{ x: number; y: number; width: number; height: number }>
  page?: number
  totalPages?: number
}

export interface ProgressPayload {
  format: ReaderFormat
  fraction: number
  locator: ReaderLocator
  page?: number
  totalPages?: number
  chapter?: string
  title?: string
}

export interface AnnotationPayload {
  id: string
  format: ReaderFormat
  locator: ReaderLocator
  text?: string
  note?: string
  color?: string
  page?: number
}

export type HostToReader =
  | { type: 'reader:open'; payload: OpenPayload }
  | { type: 'reader:theme'; payload: { theme: ReaderTheme } }
  | { type: 'reader:fontSize'; payload: { fontSize: number } }
  | { type: 'reader:flow'; payload: { flow: ReaderFlow } }
  | { type: 'reader:goTo'; payload: { locator: string } }
  | { type: 'reader:next' }
  | { type: 'reader:prev' }
  | { type: 'reader:zoom'; payload: { scale: number } }
  | { type: 'reader:annotation:add'; payload: AnnotationPayload }
  | { type: 'reader:annotation:remove'; payload: { id: string } }
  | { type: 'reader:selection:clear' }

export type ReaderToHost =
  | { type: 'reader:ready'; payload: { format: ReaderFormat; title: string; totalPages?: number; flow: ReaderFlow } }
  | { type: 'reader:selection'; payload: SelectionPayload }
  | { type: 'reader:progress'; payload: ProgressPayload }
  | { type: 'reader:annotation'; payload: AnnotationPayload }
  | { type: 'reader:annotationSelected'; payload: AnnotationPayload }
  | { type: 'reader:error'; payload: { message: string } }
  | { type: 'reader:state'; payload: Record<string, unknown> }

/** PDF 文本层的单个文本块坐标（归一化到页面，供标注锚点使用）。 */
export interface PdfTextItem {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
}

export const isReaderMessage = (value: unknown): value is HostToReader => {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && type.startsWith('reader:')
}
