export interface TocEntry { label?: string; href?: string; subitems?: TocEntry[] }
export interface FoliateSection { id?: string; href?: string; size?: number; linear?: string; createDocument?: () => Promise<Document> }
export interface FoliateLocation { cfi?: string; fraction?: number; tocItem?: { label?: string }; section?: { current?: number }; range?: Range }
export interface FoliateContent { doc: Document; index: number; overlayer?: { hitTest: (point: { x: number; y: number }) => [string?, Range?]; add: (key: string, range: Range, draw: unknown, options: unknown) => void; remove: (key: string) => void } }
export interface NavigationTarget { index: number; anchor?: number | ((doc: Document) => Range | Element | number) }
export interface FoliateSearchResult { label?: string; cfi?: string; excerpt?: { pre: string; match: string; post: string }; subitems?: FoliateSearchResult[]; progress?: number }
export interface FoliateView extends HTMLElement {
  book?: { metadata?: { language?: string | readonly string[] }; dir?: string; sections?: FoliateSection[]; toc?: TocEntry[]; resolveHref?: (href: string) => NavigationTarget; destroy?: () => void }
  renderer?: HTMLElement & { page?: number; pages?: number; atStart?: boolean; atEnd?: boolean; getViewportState?: () => Record<string, unknown> | null; getContents?: () => FoliateContent[]; setStyles?: (styles: string | readonly [string, string]) => void; render?: () => void; goTo: (target: NavigationTarget) => Promise<void> }
  lastLocation?: FoliateLocation
  open(book: unknown): Promise<void>
  close(): void
  init(options?: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>
  goTo(target: unknown): Promise<NavigationTarget | undefined>
  getCFI(index: number, range: Range): string
  resolveCFI(cfi: string): NavigationTarget
  addAnnotation(annotation: { value: string; [key: string]: unknown }, remove?: boolean): Promise<unknown>
  deleteAnnotation(annotation: { value: string; [key: string]: unknown }): Promise<unknown>
  search(options: { query: string }): AsyncGenerator<FoliateSearchResult | 'done'>
  clearSearch(): void
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
}
