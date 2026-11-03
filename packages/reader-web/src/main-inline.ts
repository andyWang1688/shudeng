import './styles.css'
import { startReaderFromUrl } from './app'

// native WebView 内联入口：只打包 EPUB（foliate），不加载 pdf.js。
// 原生 PDF 由 RN 的 PDFKit 路径渲染，不需要 reader-web 的 PDF 分支。
startReaderFromUrl()
