// Technical proof only: all renderer/CFI/overlayer code comes from one fixed MIT upstream commit.
const engine = new URLSearchParams(location.search).get('engine') === 'current' ? 'current' : 'readest'
const { Overlayer } = engine === 'current'
  ? await import('@current-upstream/overlayer.js')
  : await import('@continuous-upstream/overlayer.js')
if (engine === 'current') await import('@current-upstream/view.js')
else await import('@continuous-upstream/view.js')

const COMMIT = 'b34a0aa63163d19cd13e2ecd19b678394c32fee5'
const view = document.createElement('foliate-view')
document.querySelector('#reader').append(view)
const urls = new Map()
const loads = []
const relocations = []
const errorElement = document.querySelector('#error')
const requestedChapters = Number(new URLSearchParams(location.search).get('chapters'))
const chapterCount = Number.isInteger(requestedChapters) && requestedChapters >= 3 && requestedChapters <= 100 ? requestedChapters : 3
const labels = Array.from({ length: chapterCount }, (_, index) => chapterCount === 3 ? ['第一章 · 灯下', '第二章 · 山路', '第三章 · 归来'][index] : `第 ${index + 1} 章 · 连续滚动样例`)
const style = size => `html{background:#fffdf7;color:#27241e}body{margin:0;font: ${size}px/1.8 serif}h1{font-size:1.25em;margin:0 0 18px}p{margin:0 0 16px}p:last-child{margin-bottom:0}.end{color:#7f5124;font-weight:bold}`
const html = labels.map((label, index) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${label}</title><style>${style(18)}</style></head><body><h1 id="start">${label}</h1>${Array.from({ length: 7 }, (_, p) => `<p id="p${p}">第 ${index + 1} 章第 ${p + 1} 段。灯光落在书页上，窗外的风轻轻吹过。连续阅读时，前一章的文字仍在上方，后一章的开头沿着同一方向出现。</p>`).join('')}<p id="end" class="end">【第 ${index + 1} 章末尾】${index < chapterCount - 1 ? '继续向下就是下一章。' : '全书结束。'}</p></body></html>`)
const sections = html.map((text, index) => ({
  id: `chapter${index + 1}.xhtml`,
  size: new TextEncoder().encode(text).length,
  linear: 'yes',
  cfi: `epubcfi(/6/${(index + 1) * 2})`,
  load() {
    if (!urls.has(index)) urls.set(index, URL.createObjectURL(new Blob([text], { type: 'text/html' })))
    return urls.get(index)
  },
  loadContent: () => text,
  unload() { if (urls.has(index)) { URL.revokeObjectURL(urls.get(index)); urls.delete(index) } },
  createDocument: () => new DOMParser().parseFromString(text, 'text/html'),
}))
const book = {
  sections, dir: 'ltr', metadata: { title: '三章连续滚动验证', language: 'zh-CN' },
  rendition: { layout: 'reflowable' },
  toc: sections.map((section, index) => ({ label: labels[index], href: `${section.id}#start` })),
  resolveHref(href) {
    const [id, fragment] = href.split('#')
    const index = sections.findIndex(section => section.id === id)
    return index < 0 ? undefined : { index, anchor: doc => fragment ? doc.getElementById(fragment) : doc.body }
  },
  splitTOCHref: href => href.split('#'),
  getTOCFragment: (doc, id) => doc.getElementById(id),
}

const renderer = () => view.renderer
const contents = () => renderer()?.getContents() ?? []
// Current 1.0.1 has a closed shadow root; the same-origin content document
// still exposes its frame element, allowing the identical container geometry check.
const container = () => renderer()?.shadowRoot?.getElementById('container')
  ?? contents()[0]?.doc.defaultView.frameElement?.closest('#container')
const rect = value => ({ top: Math.round(value.top), bottom: Math.round(value.bottom), height: Math.round(value.height) })
function elementRect(doc, element) {
  if (!element) return null
  const outer = doc.defaultView.frameElement.getBoundingClientRect()
  const inner = element.getBoundingClientRect()
  return { top: inner.top + outer.top, bottom: inner.bottom + outer.top, height: inner.height }
}
function snapshot() {
  const box = container()?.getBoundingClientRect()
  const live = contents().map(content => {
    const frame = content.doc.defaultView.frameElement.getBoundingClientRect()
    const start = elementRect(content.doc, content.doc.getElementById('start'))
    const end = elementRect(content.doc, content.doc.getElementById('end'))
    const visible = box && frame.bottom > box.top && frame.top < box.bottom
    const markerVisible = marker => !!(box && marker && marker.bottom > box.top && marker.top < box.bottom)
    return { index: content.index, title: content.doc.title, visible: !!visible, frame: rect(frame), start: start && rect(start), end: end && rect(end), startVisible: markerVisible(start), endVisible: markerVisible(end), highlights: content.overlayer?.element?.childElementCount ?? 0 }
  })
  return { engine, chapterCount, closed, commit: engine === 'readest' ? COMMIT : 'local foliate-js 1.0.1 + project patch', flow: renderer()?.getAttribute('flow'), ready, operation, lastOperation, liveDocuments: live.length, visibleIndices: live.filter(x => x.visible).map(x => x.index), scrollTop: Math.round(container()?.scrollTop ?? 0), scrollHeight: container()?.scrollHeight ?? 0, viewport: box && rect(box), currentCFI: view.lastLocation?.cfi, section: view.lastLocation?.section, live, loads: [...loads], recentRelocations: relocations.slice(-8), activeBlobURLs: urls.size }
}
let renderTimer
function displayState() { document.querySelector('#state').textContent = JSON.stringify(snapshot(), null, 2) }
function scheduleState() { clearTimeout(renderTimer); renderTimer = setTimeout(displayState, 100) }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function seam(index = 0) {
  if (!ready) throw new Error('引擎尚未准备好。')
  const label = `定位第 ${index + 1} / ${index + 2} 章接缝`
  const operationId = ++operationSequence
  operation = label
  displayState()
  if (renderer().getAttribute('flow') !== 'scrolled') renderer().setAttribute('flow', 'scrolled')
  await view.goTo(index)
  if (engine !== 'current') for (let attempt = 0; attempt < 40 && !contents().some(content => content.index === index + 1); attempt++) await wait(50)
  const before = contents().find(content => content.index === index)
  const after = contents().find(content => content.index === index + 1)
  if (!before) throw new Error('当前章节尚未加载。')
  const end = elementRect(before.doc, before.doc.getElementById('end'))
  const start = after && elementRect(after.doc, after.doc.getElementById('start'))
  const box = container().getBoundingClientRect()
  container().scrollTop += (end.bottom + (start?.top ?? end.bottom)) / 2 - (box.top + box.bottom) / 2
  await wait(350)
  // Scroll/relocate schedules can redraw the panel, but only this exact
  // action may publish its completion. A newer click must keep its own label.
  if (operationSequence === operationId) {
    lastOperation = `${label}完成`
    operation = 'idle'
  }
  displayState()
  return snapshot()
}
async function highlight() {
  await seam(0)
  const doc = contents().find(content => content.index === 0).doc
  const range = doc.createRange()
  range.selectNodeContents(doc.getElementById('end'))
  const cfi = view.getCFI(0, range)
  await view.addAnnotation({ value: cfi, color: '#e0bf73' })
  displayState()
  return { cfi, text: range.toString(), state: snapshot() }
}
function act(callback) { return async () => { try { errorElement.textContent = ''; await callback() } catch (error) { errorElement.textContent = error.stack ?? String(error); operation = 'idle'; displayState() } } }
let ready = false
let operation = '打开引擎'
let lastOperation = null
let operationSequence = 0
let fontSize = 18
let closed = false
function close() {
  if (!closed) {
    view.close()
    sections.forEach(section => section.unload())
    clearTimeout(renderTimer)
    closed = true
    ready = false
    operation = 'idle'
    lastOperation = '原型已关闭'
    displayState()
  }
  return snapshot()
}
document.querySelector('#seam1').onclick = act(() => seam(0))
document.querySelector('#seam2').onclick = act(() => seam(1))
document.querySelector('#beginning').onclick = act(async () => { await view.goTo(0); await wait(350); displayState() })
document.querySelector('#flow').onclick = act(async () => {
  const scrolled = renderer().getAttribute('flow') === 'scrolled'
  renderer().setAttribute('flow', scrolled ? 'paginated' : 'scrolled')
  document.querySelector('#flow').textContent = scrolled ? '切换滚动' : '切换分页'
  await wait(350); displayState()
})
document.querySelector('#font').onclick = act(async () => { fontSize = fontSize === 18 ? 22 : 18; renderer().setStyles(style(fontSize)); await wait(350); displayState() })
document.querySelector('#highlight').onclick = act(highlight)
view.addEventListener('load', event => { loads.push(event.detail.index); scheduleState() })
view.addEventListener('relocate', event => { relocations.push({ cfi: event.detail.cfi, fraction: event.detail.fraction, index: event.detail.section?.current }); scheduleState() })
view.addEventListener('draw-annotation', event => event.detail.draw(Overlayer.highlight, { color: event.detail.annotation.color }))
window.__continuousSpike = { view, book, snapshot, seam, highlight, container, close, engine, chapterCount, commit: COMMIT }
await act(async () => {
  await view.open(book)
  renderer().setAttribute('flow', 'scrolled')
  renderer().setAttribute('max-column-count', '1')
  // Same 375×600 outer viewport, 20px vertical margins and 335px text cap.
  // Old Foliate uses margin; the fork has four separate margin attributes.
  renderer().setAttribute('margin', '20px')
  for (const side of ['top', 'bottom', 'left', 'right']) renderer().setAttribute(`margin-${side}`, '20px')
  renderer().setAttribute('gap', '0px')
  renderer().setAttribute('max-inline-size', '335px')
  renderer().setStyles(style(fontSize))
  renderer().addEventListener('scroll', scheduleState)
  renderer().addEventListener('stabilized', scheduleState)
  await view.init({ showTextStart: true })
  await wait(500)
  ready = true
  operation = 'idle'
  if (lastOperation === null) lastOperation = '引擎已打开'
  displayState()
})()
window.addEventListener('pagehide', close, { once: true })
