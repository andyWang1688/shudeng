declare module 'foliate-js/view.js' {
  export const makeBook: (file: string | Blob) => Promise<unknown>
  export class View extends HTMLElement {
    book: any
    renderer: any
    lastLocation: any
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
}

declare module 'foliate-js/overlayer.js' {
  export class Overlayer {
    static highlight(rects: DOMRect[], options?: { color?: string; padding?: number }): SVGElement
  }
}
