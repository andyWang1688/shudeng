import './styles.css'
import { setPdfReader, startReaderFromUrl } from './app'
import { PdfReader } from './pdf-reader'

// Web 开发/预览入口：保留 PDF.js，能打开 EPUB 和 PDF。
setPdfReader(PdfReader)
startReaderFromUrl()
