import type { ReaderTheme } from './protocol'

const FONT_BASE = 16 / 14
export const EPUB_GUTTER = 28

/** Match the existing reader's percentage-to-rem cascade, including typeScale=1.
 * Its 18.5/14 percentage is relative to WebKit's 16px initial root font, while
 * normalized paragraphs use 1rem rather than the CJK body's 87.5% font size. */
export function epubTypography(size: number, theme: ReaderTheme, publication: { language?: string | readonly string[] | undefined; dir?: string | undefined } = {}): readonly [string, string] {
  const paper = theme === 'dark' ? '#1B1A17' : '#FAF7F1'
  const ink = theme === 'dark' ? '#F3EEE3' : '#211E18'
  const selection = theme === 'dark' ? '#5A4A2A' : '#F2DBA6'
  const language = typeof publication.language === 'string' ? publication.language : publication.language?.[0]
  const rightToLeft = publication.dir === 'rtl'
    || (publication.dir !== 'ltr' && /^(ar|fa|he)$/i.test(language ?? ''))
  const cjk = /^(ja|ko)$/i.test(language ?? '') || /^zh(-|_|$)/i.test(language ?? '')
  // Readium's CJK/RTL stylesheet variants omit automatic justification hyphens.
  const automaticHyphens = !cjk && !rightToLeft
  // Both Readium CJK variants leave authored paragraph indentation untouched.
  const paragraphIndent = cjk ? '' : 'text-indent: 2rem !important;'
  const defaults = `/* shudeng-reader-typography */
    html { text-rendering: optimizeLegibility; -webkit-text-size-adjust: 100%; }
    h1, h2, h3 { line-height: normal; }
    body { -webkit-hyphenate-character: "-"; hyphenate-character: "-";
      -webkit-hyphenate-limit-lines: 3; hyphenate-limit-lines: 3; }
    h1, h2, h3, h4, h5, h6, dt, figcaption, pre, caption, address, center, code, var {
      -webkit-hyphens: none; hyphens: none; }
    :lang(zh), :lang(ja), :lang(ko) { overflow-wrap: break-word; line-break: strict; }
    :root[data-shudeng-unstyled] h1, :root[data-shudeng-unstyled] h2,
    :root[data-shudeng-unstyled] h3, :root[data-shudeng-unstyled] h4,
    :root[data-shudeng-unstyled] h5, :root[data-shudeng-unstyled] h6 {
      font-family: "Iowan Old Style", "Sitka Text", Palatino, "Book Antiqua", serif;
      text-align: start; margin-block: 1.5rem;
    }
    :root[data-shudeng-unstyled]:lang(zh) :is(h1,h2,h3,h4,h5,h6) {
      font-family: "方体", "PingFang SC", "黑体", "Heiti SC", "Microsoft JhengHei UI", "Microsoft JhengHei", Roboto, Noto, "Noto Sans CJK SC", sans-serif;
    }
    :root[data-shudeng-unstyled] h1 { margin-block: 3rem; }
    :root[data-shudeng-unstyled] h2 { margin-block: 3rem 1.5rem; }
    :root[data-shudeng-unstyled] h6 { margin-bottom: 0; }
    :root[data-shudeng-unstyled]:is(:lang(zh),:lang(ja),:lang(ko)) :is(h1,h2,h3) { text-align: center; }
    :root[data-shudeng-unstyled] body { text-justify: inter-character; }
    :root[data-shudeng-unstyled]:is(:lang(zh),:lang(ja),:lang(ko)) body { font-size: 87.5%; }${cjk ? `
    :root[data-shudeng-unstyled] p { text-indent: 1em; }
    :root[data-shudeng-unstyled]:lang(zh) p { text-indent: 2em; }` : ''}
  `
  const overrides = `/* shudeng-reader-typography */
    :root { --theme-bg-color: ${paper}; background: ${paper} !important; color: ${ink} !important;
      font-family: "Songti SC" !important; font-size: ${size * FONT_BASE}px !important;
      line-height: 1.75 !important; }
    :root * { background-color: transparent !important; }
    :root *:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6):not(pre) { color: inherit !important; }
    :root body, :root p, :root li, :root div, :root dt, :root dd { font-family: inherit !important; }
    :root :is(i,em,cite,b,strong,span):not([lang]):not([xml\:lang]) { font-family: inherit !important; }
    :root body, :root p, :root li, :root div { line-height: inherit; }
    :root body, :root p, :root li { text-align: justify !important; }
    ${automaticHyphens ? ':root body { -webkit-hyphens: auto; hyphens: auto; }' : ''}
    :root p, :root li, :root div, :root pre, :root dd,
    :root h1, :root h2, :root h3, :root h4, :root h5, :root h6 { font-size: 1rem !important; }
    :root p { ${paragraphIndent} margin-top: 1.5rem !important; margin-bottom: 1.5rem !important; }
    ::selection { background: ${selection} !important; color: ${ink} !important; }
  `
  return [defaults, overrides]
}

/** Run before Foliate fills html.lang, retaining Native's body-language priority.
 * Foliate's two empty style ports already exist; authored CSS suppresses defaults. */
export function prepareTypographyDocument(doc: Document, publicationLanguage?: string | readonly string[]): (() => void) | undefined {
  const language = typeof publicationLanguage === 'string' ? publicationLanguage : publicationLanguage?.[0]
  const cjk = /^(ja|ko)$/i.test(language ?? '') || /^zh(-|_|$)/i.test(language ?? '')
  const root = doc.documentElement
  const authoredLanguage = cjk ? root.getAttribute('lang') : null
  if (language !== undefined && cjk && !root.hasAttribute('lang') && !root.hasAttribute('xml:lang')) {
    const bodyLanguage = doc.body?.getAttribute('xml:lang') ?? doc.body?.getAttribute('lang')
    const effectiveLanguage = bodyLanguage || language
    // Readium injects only xml:lang, including when the body supplies it.
    for (const element of bodyLanguage ? [root] : [root, doc.body]) {
      element?.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', effectiveLanguage)
    }
  }
  const authored = doc.querySelector('link, [style]') !== null
    || Array.from(doc.querySelectorAll('style')).some(style => style !== doc.head?.firstElementChild
      && style !== doc.head?.lastElementChild)
  if (!authored) doc.documentElement.setAttribute('data-shudeng-unstyled', '')
  // Foliate fills even an authored empty html.lang. Restore its original state
  // after the view load event, keeping Native's xml:lang/explicit-empty contract.
  return cjk ? () => {
    if (authoredLanguage === null) root.removeAttribute('lang')
    else root.setAttribute('lang', authoredLanguage)
  } : undefined
}
