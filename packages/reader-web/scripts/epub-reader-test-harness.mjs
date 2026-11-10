import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { epubTypography, prepareTypographyDocument, EPUB_GUTTER } from '../src/epub-typography.ts';
import * as location from '../src/epub-location.ts';
import * as viewport from '../src/epub-viewport.ts';
import * as selection from '../src/epub-selection.ts';
import * as bookmarks from '../src/epub-bookmarks.ts';

const requireHere = createRequire(import.meta.url);
const ts = requireHere('typescript');
function loadSource(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (!(name in imports)) throw new Error('Unexpected browser dependency: ' + name);
    return imports[name];
  }, exports);
  return exports;
}

const element = () => ({ style: { setProperty() {} }, dataset: {}, addEventListener() {}, replaceChildren() {}, append() {} });

export function readerHarness({ language, loadDocument, onProgress = () => {}, onMessage = () => {} } = {}) {
  const log = [], attributes = new Map(), listeners = new Map(), rendererListeners = [];
  const renderer = {
    style: {}, addEventListener(name, callback, options) { rendererListeners.push({ name, callback, capture: options?.capture === true }); }, getContents: () => [],
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => { attributes.set(name, value); log.push(['attribute', name, value]); },
    removeAttribute: name => { attributes.delete(name); log.push(['remove-attribute', name]); },
    setStyles: styles => log.push(['styles', styles]),
    goTo: async target => log.push(['goTo', target]),
    start: 0, end: 600, size: 600, viewSize: 1800, scrollProp: 'scrollTop',
  };
  const view = {
    addEventListener(name, callback, options) {
      const registered = listeners.get(name) ?? [];
      registered.push({ callback, once: options?.once === true });
      listeners.set(name, registered);
    },
    async open(book) {
      this.book = book; this.renderer = renderer; log.push(['view-open']);
      // Foliate's renderer listener fills a missing html.lang before it emits
      // the view load event. Capture listeners must prepare the original DOM.
      renderer.addEventListener('load', event => {
        event.detail.doc.documentElement.lang ||= Intl.getCanonicalLocales(language ?? [])[0] ?? '';
        for (const listener of listeners.get('load') ?? []) listener.callback(event);
        listeners.set('load', (listeners.get('load') ?? []).filter(listener => !listener.once));
      });
    },
    async init() {
      if (loadDocument) for (const capture of [true, false]) {
        for (const listener of rendererListeners) if (listener.name === 'load' && listener.capture === capture) {
          listener.callback({ detail: { doc: loadDocument, index: 0 } });
        }
      }
      log.push(['first-layout', { attributes: Object.fromEntries(attributes), styles: log.filter(item => item[0] === 'styles').at(-1)?.[1] }]);
      this.lastLocation = { cfi: 'epubcfi(/6/2!/4/2/1:0)', fraction: 0, section: { current: 0 } };
      for (const listener of listeners.get('relocate') ?? []) listener.callback({ detail: this.lastLocation });
    },
    close() {}, resolveCFI: () => ({ index: 0, anchor: 0 }), addAnnotation: async () => {},
    next: async () => log.push(['next']), prev: async () => log.push(['prev']),
  };
  const host = { ...element(), getBoundingClientRect: () => ({ width: 375 }) };
  globalThis.document = { createElement: () => view };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const { EpubReader } = loadSource('../src/epub-reader.ts', {
    'foliate-js/view.js': { makeBook: async () => ({ metadata: { language }, sections: [{ id: 'chapter.xhtml', size: 10 }] }) },
    'foliate-js/epub.js': {}, 'foliate-js/overlayer.js': { Overlayer: {} },
    './foliate-resource-loader': {}, './epub-sandbox': { securePublication() {} }, './bridge': { bridge: { send: onMessage } },
    './epub-location': location, './note-wave': {}, './epub-selection': selection, './epub-bookmarks': bookmarks,
    './epub-typography': { epubTypography, prepareTypographyDocument, EPUB_GUTTER },
    './epub-viewport': viewport,
  });
  return { reader: new EpubReader(host, onProgress), log, host, renderer, emitRenderer(name, event) {
    for (const listener of rendererListeners) if (listener.name === name) listener.callback(event);
  }, emitLoad(doc, index = 0) {
    for (const listener of listeners.get('load') ?? []) listener.callback({ detail: { doc, index } });
  }, emitRelocate(detail) {
    view.lastLocation = detail;
    for (const listener of listeners.get('relocate') ?? []) listener.callback({ detail });
  } };
}

export function appHarness() {
  const calls = [], controls = new Map();
  const getControl = id => { if (!controls.has(id)) controls.set(id, element()); return controls.get(id); };
  globalThis.document = { querySelector: getControl, body: element() };
  globalThis.window = { addEventListener() {} };
  class EpubReader {
    setSelectionActionsEnabled() {}
    open(...args) { calls.push(['open', ...args]); return Promise.resolve(); }
    setTheme(value) { calls.push(['theme', value]); }
    setFontSize(value) { calls.push(['font', value]); }
    setFlow(value) { calls.push(['flow', value]); }
    goTo(value) { calls.push(['goTo', value]); }
    bookmarkContext(...args) { calls.push(['bookmarkContext', ...args]); }
    getState() { return {}; }
  }
  loadSource('../src/app.ts', { './styles.css': {}, './bridge': { bridge: { onMessage() {}, send() {} } }, './epub-reader': { EpubReader } });
  return { calls, open: window.__readerHarness.open, dispatch: window.__readerHarness.dispatch };
}
