// Foliate's PDF adapter expects Readest-hosted globals and assets. Book PDFs
// enter the dedicated PDF reader, never this EPUB loader.
export function makePDF(): never {
  throw new Error('请通过 PDF 阅读器打开此文件')
}
