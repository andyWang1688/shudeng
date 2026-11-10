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
    static squiggly(rects: DOMRect[], options?: { color?: string; padding?: number; width?: number }): SVGElement
  }
}

declare module 'foliate-js/epub.js' {
  export class EPUB {
    constructor(loader: {
      entries: readonly { filename: string; uncompressedSize: number }[]
      loadText(path: string): Promise<string | null>
      loadBlob(path: string, mimeType?: string): Promise<Blob | null>
      getSize(path: string): number
    })
    init(): Promise<unknown>
  }
}
