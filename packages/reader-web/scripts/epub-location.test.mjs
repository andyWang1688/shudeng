import { test } from 'node:test'
import assert from 'node:assert/strict'
import { epubChapterTitle, epubTarget, paintedEpubAnchor, publicationStartFraction, samePublicationHref, textRangeForQuote } from '../src/epub-location.ts'
import { indexedDocumentText, rangeAtIndexedOffset } from '../src/epub-indexed-range.ts'
import { epubDocumentText } from '../../core/src/rag/epub-xml.ts'
import { legacyIndexedDocumentText, legacyQuoteText } from './epub-mapping-oracle.mjs'
import { mappingDocument } from './epub-test-dom.mjs'
import { readerHarness, appHarness } from './epub-reader-test-harness.mjs'
import { epubTypography, prepareTypographyDocument } from '../src/epub-typography.ts'
import { readFileSync } from 'node:fs'

globalThis.Node ??= { TEXT_NODE: 3, CDATA_SECTION_NODE: 4, ELEMENT_NODE: 1 }
globalThis.NodeFilter ??= { SHOW_TEXT: 4 }

test('CJK paragraph indentation follows both Readium stylesheet variants without resetting author CSS', () => {
  for (const variant of ['cjk-horizontal', 'cjk-vertical']) {
    const nativeCSS = readFileSync(new URL('../../../Vendor/Readium/Sources/Navigator/EPUB/Assets/Static/readium-css/' + variant + '/ReadiumCSS-after.css', import.meta.url), 'utf8')
    assert.doesNotMatch(nativeCSS, /text-indent\s*:/, variant + ' has no reader indentation override')
  }
  // The giant chapter has author CSS, so its lack of text-indent retains the
  // CSS initial 0; a book's explicit indent remains its own choice.
  for (const language of ['zh', 'zh-CN', 'zh-Hant', 'ZH_tw', 'ja', 'ko']) {
    for (const dir of ['ltr', 'rtl']) {
      const [, overrides] = epubTypography(18.5, 'light', { language, dir })
      assert.doesNotMatch(overrides, /text-indent\s*:/, language + '/' + dir + ' must not override or reset author indentation')
      assert.match(overrides, /margin-top: 1\.5rem !important; margin-bottom: 1\.5rem !important;/, 'paragraph spacing is unchanged')
    }
  }
})

test('indentation uses the first publication language and preserves non-CJK behavior', () => {
  assert.doesNotMatch(epubTypography(18.5, 'dark', { language: ['zh-CN', 'en'] })[1], /text-indent\s*:/)
  // Native isCJK accepts exact ja/ko and the zh language prefix; it does not
  // classify script subtags or normalize Japanese/Korean region subtags.
  for (const language of [undefined, '', 'en', 'en-Hans', 'ja-JP', 'ko-KR', 'ar', ['en', 'zh-CN']]) {
    const [, overrides] = epubTypography(18.5, 'light', { language })
    assert.match(overrides, /:root p \{[^}]*text-indent: 2rem !important;/, String(language))
  }
})

test('only unstyled CJK documents receive Native default paragraph indentation by document language', () => {
  for (const variant of ['cjk-horizontal', 'cjk-vertical']) {
    const nativeCSS = readFileSync(new URL('../../../Vendor/Readium/Sources/Navigator/EPUB/Assets/Static/readium-css/' + variant + '/ReadiumCSS-default.css', import.meta.url), 'utf8')
    assert.match(nativeCSS, /--RS__paraIndent: 1em;/)
    assert.match(nativeCSS, /:root:lang\(zh\)\s*\{\s*--RS__paraIndent: 2em;/)
    assert.match(nativeCSS, /p\s*\{[^}]*text-indent: var\(--RS__paraIndent\);/)
  }
  for (const language of ['zh-CN', 'ja', 'ko', ['zh-CN', 'en']]) {
    const [defaults] = epubTypography(18.5, 'light', { language })
    const indentRules = Array.from(defaults.matchAll(/([^{}]+)\{([^{}]*text-indent\s*:[^{}]*)\}/g))
    assert.deepEqual(indentRules.map(([, selector, declarations]) => [selector.trim(), declarations.trim()]), [
      [':root[data-shudeng-unstyled] p', 'text-indent: 1em;'],
      [':root[data-shudeng-unstyled]:lang(zh) p', 'text-indent: 2em;'],
    ], 'defaults use the actual document root language, not a fixed metadata indent')
  }
  for (const language of ['en', 'ja-JP', 'ko-KR', undefined]) {
    assert.doesNotMatch(epubTypography(18.5, 'light', { language })[0], /text-indent\s*:/, 'non-CJK defaults remain unchanged')
  }
  for (const authored of ['none', 'link', 'inline', 'style']) {
    const first = {}, last = {}, attributes = new Map()
    const doc = {
      head: { firstElementChild: first, lastElementChild: last },
      documentElement: { setAttribute: (key, value) => attributes.set(key, value) },
      querySelector: () => authored === 'link' || authored === 'inline' ? {} : null,
      querySelectorAll: () => authored === 'style' ? [first, {}, last] : [first, last],
    }
    prepareTypographyDocument(doc)
    assert.equal(attributes.has('data-shudeng-unstyled'), authored === 'none', authored + ' author CSS gate')
  }
})

function typographyDocument(rootLanguage = {}, bodyLanguage = {}, authored = false) {
  const element = (initial) => {
    const attributes = new Map(Object.entries(initial))
    return {
      get lang() { return attributes.get('lang') ?? '' },
      set lang(value) { attributes.set('lang', value) },
      hasAttribute: key => attributes.has(key),
      getAttribute: key => attributes.get(key) ?? null,
      setAttribute: (key, value) => attributes.set(key, value),
      setAttributeNS: (_namespace, key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key),
    }
  }
  const first = {}, last = {}
  return {
    documentElement: element(rootLanguage), body: element(bodyLanguage),
    head: { firstElementChild: first, lastElementChild: last },
    querySelector: () => authored ? {} : null, querySelectorAll: () => [first, last],
    addEventListener() {},
  }
}

test('CJK language injection preserves root attributes, promotes body language, then falls back to first publication language', () => {
  const cases = [
    [{ lang: 'ja' }, { lang: 'zh-CN' }, 'ja'],
    [{ 'xml:lang': 'ko' }, { lang: 'zh-CN' }, 'ko'],
    [{ lang: '' }, { lang: 'zh-CN' }, ''],
    [{}, { lang: 'ja', 'xml:lang': 'ko' }, 'ko'],
    [{}, { lang: 'ja' }, 'ja'],
    [{}, {}, 'zh-CN'],
  ]
  for (const [rootLanguage, bodyLanguage, expected] of cases) {
    for (const authored of [false, true]) {
      const doc = typographyDocument(rootLanguage, bodyLanguage, authored)
      prepareTypographyDocument(doc, ['zh-CN', 'en'])
      assert.equal(doc.documentElement.getAttribute('xml:lang') ?? doc.documentElement.getAttribute('lang'), expected)
      assert.equal(doc.documentElement.hasAttribute('data-shudeng-unstyled'), !authored)
    }
  }
})

test('reader prepares CJK language before Foliate fills the root language', async () => {
  for (const [rootLanguage, bodyLanguage, expected] of [
    [{}, { lang: 'ja' }, 'ja'],
    [{}, {}, 'zh-CN'],
    [{ lang: '' }, { lang: 'ja' }, ''],
    [{ 'xml:lang': '' }, { lang: 'ja' }, ''],
    [{ lang: 'ja', 'xml:lang': 'ko' }, {}, 'ko'],
  ]) {
    const doc = typographyDocument(rootLanguage, bodyLanguage)
    const { reader } = readerHarness({ language: ['zh-CN'], loadDocument: doc })
    await reader.open('fixture.epub', 'Fixture')
    assert.equal(doc.documentElement.getAttribute('xml:lang') ?? doc.documentElement.getAttribute('lang'), expected, 'Native effective language after Foliate load')
    assert.equal(doc.documentElement.getAttribute('lang'), rootLanguage.lang ?? null, 'preserve authored lang, including absent and empty')
  }
})

test('an empty image range navigates to its painted media element across document realms', () => {
  const image = { nodeType: 1, matches: selector => selector.includes('img') }
  const emptyRange = { startContainer: { childNodes: [image] }, startOffset: 0, endContainer: image, toString: () => '' }
  assert.equal(paintedEpubAnchor(emptyRange), image)
  const textRange = { ...emptyRange, toString: () => 'Visible prose' }
  assert.equal(paintedEpubAnchor(textRange), textRange)
  assert.equal(paintedEpubAnchor(.4), .4)
})

test('image ranges prefer contained media over the terminal image and exclude earlier media', () => {
  const document = { createRange: () => ({ selectNode(element) { this.element = element } }) }
  const image = (before, after) => ({ nodeType: 1, matches: () => true, ownerDocument: document, before, after })
  const outside = image(0, 1), first = image(3, 4), second = image(5, 6)
  const whitespace = { nodeType: 1, matches: () => false }
  const root = { nodeType: 1, matches: () => false, childNodes: [whitespace], querySelectorAll: () => [outside, first, second] }
  const range = { startContainer: root, startOffset: 0, endContainer: second, commonAncestorContainer: root, toString: () => ' ',
    compareBoundaryPoints: (how, bounds) => how === 0 ? 2 - bounds.element.before : 5 - bounds.element.after }
  assert.equal(paintedEpubAnchor(range), first)
  root.querySelectorAll = () => [outside, second]
  assert.equal(paintedEpubAnchor(range), range)
  range.endOffset = 0
  assert.equal(paintedEpubAnchor(range), second)
  root.querySelectorAll = () => [outside, first, second]
  assert.equal(paintedEpubAnchor(range), first)
  range.toString = () => 'Visible prose'
  assert.equal(paintedEpubAnchor(range), range)
})

test('chapter chrome starts with the book title and retains the last nonempty locator title', () => {
  assert.equal(epubChapterTitle('A Book'), 'A Book')
  assert.equal(epubChapterTitle('Another Book', ''), 'Another Book')
  assert.equal(epubChapterTitle('A Book', 'Chapter One'), 'Chapter One')
  assert.equal(epubChapterTitle('A Book', undefined, 'Chapter One'), 'Chapter One')
  assert.equal(epubChapterTitle('A Book', '', 'Chapter One'), 'Chapter One')
  assert.equal(epubChapterTitle('A Book', 'Chapter Two', 'Chapter One'), 'Chapter Two')
})

test('migrated Readium passage keeps its exact quote and selector, not only its chapter', () => {
  const readium = { href: 'OEBPS/chapter1.xhtml', locations: { cssSelector: '#fixture-paragraph-0', progression: 0, totalProgression: 0 }, text: { highlight: '黛玉方进入房时，只见两个人搀着一位鬓发如银的老母迎上来。' } }
  const target = epubTarget(JSON.stringify({ type: 'epub', cfi: JSON.stringify(readium) }))
  assert.equal(target.href, readium.href)
  assert.equal(target.quote, readium.text.highlight)
  assert.equal(target.selector, '#fixture-paragraph-0')
  assert.equal(target.progression, 0)
})

test('raw CFI, AnchorV3 and new content index references resolve without losing context', () => {
  assert.deepEqual(epubTarget('epubcfi(/6/4)'), { cfi: 'epubcfi(/6/4)' })
  assert.equal(epubTarget(JSON.stringify({ schema: 'shudeng.anchor.v3', locator: { cfi: 'epubcfi(/6/6)' } })).cfi, 'epubcfi(/6/6)')
  assert.equal(epubTarget(JSON.stringify({ engine: 'rag-chunk-v1', href: 'OEBPS/ch2.xhtml', progression: .4, text: { highlight: '真正引用' } })).quote, '真正引用')
  assert.throws(() => epubTarget('{}'), /没有可用/)
})

test('single-page book starts at zero instead of appearing fully read', () => {
  assert.equal(publicationStartFraction([{ size: 2400 }], 0, 0), 0)
})

test('chapter progression uses chapter weights and excludes non-linear navigation', () => {
  const sections = [{ size: 100, linear: 'no' }, { size: 1000 }, { size: 3000 }]
  assert.equal(publicationStartFraction(sections, 1, 0), 0)
  assert.equal(publicationStartFraction(sections, 2, 0), .25)
  assert.equal(publicationStartFraction(sections, 2, .5), .625)
  assert.equal(publicationStartFraction(sections, 2, 1), 1)
  assert.equal(publicationStartFraction([], 0, Number.NaN), 0)
})

test('archive path matching tolerates legacy relative paths and URI encoding', () => {
  assert.equal(samePublicationHref('OEBPS/第一章.xhtml', './第一章.xhtml#section'), true)
  assert.equal(samePublicationHref('/OEBPS/ch1.xhtml', 'OEBPS/ch1.xhtml'), true)
  assert.equal(samePublicationHref('OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml'), false)
})

const mappedPoint = (mapped, index) => mapped.pointAt ? mapped.pointAt(index) : mapped.points[index] ?? null
function assertPoint(actual, expected, label) {
  assert.equal(actual?.node ?? null, expected?.node ?? null, label + ' node')
  assert.equal(actual?.offset ?? null, expected?.offset ?? null, label + ' raw UTF16 offset')
}
function assertRange(actual, expectedStart, expectedEnd, label) {
  if (!expectedStart || !expectedEnd) { assert.equal(actual, null, label); return }
  assert.equal(actual?.startContainer, expectedStart.node, label + ' start node')
  assert.equal(actual?.startOffset, expectedStart.offset, label + ' start offset')
  assert.equal(actual?.endContainer, expectedEnd.node, label + ' end node')
  assert.equal(actual?.endOffset, expectedEnd.offset + 1, label + ' end offset')
}

test('sparse index preserves every legacy UTF16 endpoint and the ingestion text contract', () => {
  const fixtures = [
    '<p>  A\t\tB\r C\n \n\n\n D  </p><p/><p>尾😀é👨‍👩‍👧</p>',
    '<p>before<span> \t </span><b>inside</b>\n after</p><div><p/><br/><hr/><p>end</p></div>',
    '<p>\n\n\n\n\nalpha\n \n\n \n beta\n\n\n\n\n</p>',
    '<p>A<![CDATA[\t\tB\n\n\nC😀]]><span>D</span></p>',
    '<p>\u00a0\u2003A\u00a0B\u2028C\ufeff </p><nav>omitted</nav><p hidden="">hidden</p><p aria-hidden="true">hidden</p><script>bad</script><style>bad</style><noscript>bad</noscript>',
    '<p/><div/><p> \t\n </p>',
  ]
  // A fixed PRNG varies whitespace around inline/block boundaries reproducibly.
  let seed = 0x5818
  const choices = ['A', '中', '😀', ' ', '  ', '\t', '\r', '\n', '\n\n\n\n', '\u00a0', 'é']
  for (let index = 0; index < 40; index++) {
    let source = '<p>'
    for (let part = 0; part < 45; part++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const value = choices[seed % choices.length]
      source += part % 9 === 0 ? '<span>' + value + '</span>' : part % 13 === 0 ? '</p><p>' + value : value
    }
    fixtures.push(source + '</p>')
  }
  for (const [fixture, content] of fixtures.entries()) {
    const doc = mappingDocument(content), old = legacyIndexedDocumentText(doc), mapped = indexedDocumentText(doc)
    assert.equal(mapped.text, old.text, 'legacy text fixture ' + fixture)
    assert.equal(mapped.text, epubDocumentText(doc), 'ingestion text fixture ' + fixture)
    for (let offset = 0; offset < old.text.length; offset++) {
      const label = 'fixture ' + fixture + ', UTF16 ' + offset
      assertPoint(mappedPoint(mapped, offset), old.points[offset], label)
      assertRange(rangeAtIndexedOffset(doc, offset, offset + 1, old.text.slice(offset, offset + 1)), old.points[offset], old.points[offset], label)
      const end = Math.min(old.text.length, offset + 7)
      assertRange(rangeAtIndexedOffset(doc, offset, end, old.text.slice(offset, end)), old.points[offset], old.points[end - 1], label + ' range')
    }
  }
})

test('index rejects invalid, empty, mismatching and out-of-range offsets', () => {
  const doc = mappingDocument('<p>word</p>')
  for (const [start, end, quote] of [[-1, 1, 'w'], [0, 0, ''], [0, 1.5, 'w'], [NaN, 1, 'w'], [0, 1, 'x'], [4, 5, ''], [0, 9, 'word']]) assert.equal(rangeAtIndexedOffset(doc, start, end, quote), null)
  const mapped = indexedDocumentText(doc)
  for (const at of [-1, 4, NaN, 1.5]) assert.equal(mappedPoint(mapped, at), null)
})

test('quote fallback keeps whitespace, selector, context, ambiguity and endpoint behavior', () => {
  const doc = mappingDocument('<p id="a">甲 <span>😀\t乙</span>\u00a0丙</p><p id="b">前 甲<span>😀乙</span>丙 后</p><nav>导航</nav><p hidden="">隐藏</p><script>不应匹配</script>')
  const old = legacyQuoteText(doc, doc.body)
  for (let start = 0; start < old.text.length; start++) {
    const end = Math.min(start + 4, old.text.length), quote = old.text.slice(start, end), first = old.text.indexOf(quote)
    assertRange(textRangeForQuote(doc, quote), old.points[first], old.points[first + quote.length - 1], 'quote offset ' + start)
  }
  const selected = legacyQuoteText(doc, doc.querySelector('#b')), at = selected.text.indexOf('甲😀乙丙')
  assertRange(textRangeForQuote(doc, '甲 😀乙 丙', { selector: '#b' }), selected.points[at], selected.points[at + 4], 'selector')
  assertRange(textRangeForQuote(doc, '甲😀乙丙', { before: '前 ', after: ' 后' }), selected.points[at], selected.points[at + 4], 'context')
  assert.equal(textRangeForQuote(doc, '不应匹配'), null)
  assert.equal(textRangeForQuote(doc, '甲', { selector: '#missing' }), null)
  assert.equal(textRangeForQuote(doc, ' \t\n '), null)
  assert.throws(() => textRangeForQuote(doc, '甲😀乙丙', { textOffset: { start: 999, end: 1004 } }), /出现多次/)
})

test('contiguous text retains one interval rather than one object per UTF16 unit', () => {
  const doc = mappingDocument('<p>' + 'x😀 y '.repeat(10_000) + '</p>'), mapped = indexedDocumentText(doc)
  assert.equal(mapped.text.length, 59_999)
  assert.equal(mapped.spans?.length, 1)
  assert.equal('points' in mapped, false)
})

test('the first EPUB layout uses the requested typography and flow exactly once', async () => {
  const { reader, log, host } = readerHarness()
  await reader.open('fixture.epub', 'Fixture', { theme: 'dark', fontSize: 24, flow: 'scrolled' })
  const initial = log.find(item => item[0] === 'first-layout')[1]
  assert.equal(host.dataset.theme, 'dark')
  assert.equal(initial.attributes.flow, 'scrolled')
  assert.equal(initial.attributes.margin, '28px')
  assert.match(initial.styles[1], /font-size: 27\.428571428571427px/)
  assert.match(initial.styles[1], /#1B1A17/)
  assert.equal(log.filter(item => item[0] === 'styles').length, 1)
  const afterOpen = log.length
  await reader.setTheme('dark'); await reader.setFontSize(24); await reader.setFlow('scrolled')
  assert.equal(log.length, afterOpen, 'same ready-time configuration must not reflow or restore CFI')
  await reader.setFontSize(100)
  const afterClamp = log.length
  await reader.setFontSize(37)
  assert.equal(log.length, afterClamp, 'equal effective clamped size must not restore CFI')
  await reader.setFlow('paginated')
  assert.equal(log.filter(item => item[0] === 'goTo').length, 2, 'each real font/flow change restores the current CFI once')
  assert.equal(log.filter(item => item[0] === 'attribute' && item[1] === 'margin').length, 1)
  assert.equal(log.filter(item => item[0] === 'attribute' && item[1] === 'max-column-count').length, 1)
})

test('app opening passes initial configuration without replaying three setters', async () => {
  const { calls, open } = appHarness()
  await open({ format: 'epub', archive: { sessionID: 'test' }, title: 'Fixture', url: 'inline://epub', theme: 'dark', fontSize: 24, flow: 'scrolled', initialLocation: 'epubcfi(/6/2)' })
  assert.deepEqual(calls, [
    ['open', { sessionID: 'test' }, 'Fixture', { theme: 'dark', fontSize: 24, flow: 'scrolled' }],
    ['goTo', 'epubcfi(/6/2)'],
  ])
})
