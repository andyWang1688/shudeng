import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ElementRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { usePalette, type Palette } from '../ui/theme';
import { readerFixtures } from './readerFixtures';
import { readerWebHtml } from './readerWebHtml';
import {
  mapIncomingToReaderEvent,
  openPayloadForBook,
  parseIncomingMessage,
  type IncomingMessage,
  type ReaderAnnotationSeed,
  type ReaderEvent,
  type ReaderLocator,
  type SelectionRect,
} from './readerProtocol';
import { ReaderSelectionBar } from './ReaderSelectionBar';

export type { ReaderEvent };

type ReaderWebViewProps = {
  readonly bookId: string;
  readonly initialLocation: string | undefined;
  readonly openOverride:
    | undefined
    | {
    readonly format: 'epub' | 'pdf';
    readonly title: string;
    readonly dataBase64: string;
      readonly mimeType: string;
    };
  readonly initialAnnotations?: readonly ReaderAnnotationSeed[];
  /** 是否显示 ReaderWebView 内置选字浮层；宿主自己渲染选字栏时传 false。默认 true。 */
  readonly selectionBar?: boolean;
  /** 阅读器主题；深色模式传 dark 让 reader-web 正文/背景切换。 */
  readonly theme?: 'light' | 'dark';
  readonly onTap?: () => void;
  readonly onEvent: (event: ReaderEvent) => void;
};

export type ReaderWebViewHandle = {
  highlightSelection: (locator: ReaderLocator, quote: string) => void;
  clearSelection: () => void;
};

type SelectionState = {
  readonly quote: string;
  readonly locator: NonNullable<Extract<ReaderEvent, { type: 'selection' }>['locator']>;
  readonly rects: readonly SelectionRect[] | undefined;
};

/**
 * 原生 WebView 壳：加载自包含 reader-web HTML（EPUB/PDF fixture base64 直接注入），
 * 通过 reader:open/ready/selection/progress/annotation 协议与网页阅读器双向通信。
 * Expo Web 使用 ReaderWebView.web.tsx 的 iframe 实现；这里只在 iOS/Android 生效。
 */
export const ReaderWebView = forwardRef<ReaderWebViewHandle, ReaderWebViewProps>(function ReaderWebView(
  { bookId, initialLocation, openOverride, initialAnnotations, selectionBar = true, theme = 'light', onTap, onEvent },
  ref,
) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const webViewRef = useRef<ElementRef<typeof WebView>>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const openSent = useRef(false);
  const annotationsHydrated = useRef(false);

  const format = useMemo(() => (bookId.toLowerCase().includes('pdf') ? 'pdf' : 'epub'), [bookId]);
  const fixture = readerFixtures[format];

  const parityScript = useMemo(() => `
    (function () {
      var hide = document.createElement('style');
      hide.textContent = '#chrome, #footer { display: none !important; } #app { padding: 0 !important; height: 100% !important; } #reader { height: 100vh !important; }';
      (document.head || document.documentElement).appendChild(hide);
      function sendTap() {
        try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'reader:tap' })); } catch (e) {}
      }
      function attach(doc) {
        if (!doc || doc.__readerTapBridge) return;
        doc.__readerTapBridge = true;
        doc.addEventListener('click', function (event) {
          var selection = doc.getSelection && doc.getSelection();
          if (selection && selection.type === 'Range' && selection.toString().trim()) return;
          if (event.target && event.target.closest && event.target.closest('a,button,input,textarea')) return;
          var win = doc.defaultView;
          var width = win ? win.innerWidth : doc.documentElement.clientWidth;
          var x = typeof event.clientX === 'number' ? event.clientX : 0;
          if (width > 0 && (x < width * 0.3 || x > width * 0.7)) return;
          sendTap();
        }, true);
      }
      attach(document);
      function attachFrames() {
        document.querySelectorAll('iframe').forEach(function (frame) {
          if (frame.__readerBridge) return;
          frame.__readerBridge = true;
          function bind() {
            try { attach(frame.contentDocument); } catch (e) {}
          }
          bind();
          frame.addEventListener('load', bind);
        });
      }
      var pending = false;
      function scheduleAttach() {
        if (pending) return;
        pending = true;
        var next = window.requestAnimationFrame || function (cb) { setTimeout(cb, 16); };
        next(function () { pending = false; attachFrames(); });
      }
      attachFrames();
      if (typeof MutationObserver === 'function') {
        // 翻页可能新增 iframe：只在新增节点包含 iframe 时重绑，替代 400ms 轮询。
        new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            var added = records[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
              var node = added[j];
              if (node.nodeType === 1 && (node.tagName === 'IFRAME' || (node.querySelector && node.querySelector('iframe')))) {
                scheduleAttach();
                return;
              }
            }
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
      }
    })();
  `, []);

  const send = useCallback((message: object) => {
    const json = JSON.stringify(message);
    webViewRef.current?.injectJavaScript(`window.__readerHost && window.__readerHost(${json}); true;`);
  }, []);

  const injectOpen = useCallback(() => {
    if (openSent.current) return;
    openSent.current = true;
    const message = JSON.stringify(openOverride
      ? { type: 'reader:open', payload: { format: openOverride.format, url: `inline://${openOverride.format}`, title: openOverride.title, dataBase64: openOverride.dataBase64, mimeType: openOverride.mimeType, theme, ...(initialLocation ? { initialLocation } : {}) } }
      : { ...openPayloadForBook(bookId, fixture, initialLocation), payload: { ...openPayloadForBook(bookId, fixture, initialLocation).payload, theme } });
    // HTML 的 module 脚本可能晚于 onLoadEnd 执行，注入前轮询等待 __readerHost 就绪。
    webViewRef.current?.injectJavaScript(`
      (function () {
        var message = ${message};
        var attempts = 0;
        function deliver() {
          if (window.__readerHost) { window.__readerHost(message); return; }
          if (attempts++ < 120) setTimeout(deliver, 50);
        }
        deliver();
      })(); true;
    `);
  }, [bookId, fixture, initialLocation, openOverride, theme]);

  useImperativeHandle(ref, () => ({
    highlightSelection: (locator: ReaderLocator, quote: string) => {
      send({
        type: 'reader:annotation:add',
        payload: {
          id: `reader-${Date.now()}`,
          format,
          locator,
          text: quote,
          color: 'yellow',
        },
      });
      send({ type: 'reader:selection:clear' });
      setSelection(null);
    },
    clearSelection: () => {
      send({ type: 'reader:selection:clear' });
      setSelection(null);
    },
  }), [format, send]);

  const handleMessage = useCallback((incoming: IncomingMessage) => {
    if (incoming.type === 'reader:ready') {
      // 原生壳已提供工具栏/进度/问答入口，隐藏网页阅读器自带 chrome，避免双层工具栏。
      webViewRef.current?.injectJavaScript(`
        (function () {
          if (document.getElementById('shudeng-native-chrome')) return true;
          var style = document.createElement('style');
          style.id = 'shudeng-native-chrome';
          style.textContent = '#chrome, #footer { display: none !important; }';
          document.head.appendChild(style);
          return true;
        })(); true;
      `);
      if (!annotationsHydrated.current && initialAnnotations?.length) {
        annotationsHydrated.current = true;
        for (const annotation of initialAnnotations) {
          send({ type: 'reader:annotation:add', payload: annotation });
        }
      }
    }
    if (incoming.type === 'reader:selection') {
      setSelection({
        quote: incoming.payload.text,
        locator: incoming.payload.locator,
        rects: incoming.payload.rects,
      });
    }
    const event = mapIncomingToReaderEvent(incoming);
    if (event) onEvent(event);
  }, [initialAnnotations, onEvent, send]);

  const highlightSelection = useCallback(() => {
    if (!selection) return;
    send({
      type: 'reader:annotation:add',
      payload: {
        id: `reader-${Date.now()}`,
        format,
        locator: selection.locator,
        text: selection.quote,
        color: 'yellow',
      },
    });
    send({ type: 'reader:selection:clear' });
    setSelection(null);
    onEvent({ type: 'annotationAdded', locator: selection.locator, quote: selection.quote });
  }, [format, onEvent, selection, send]);

  const cancelSelection = useCallback(() => {
    send({ type: 'reader:selection:clear' });
    setSelection(null);
  }, [send]);

  useEffect(() => {
    setSelection(null);
    openSent.current = false;
    annotationsHydrated.current = false;
  }, [bookId]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        style={styles.webView}
        originWhitelist={['*']}
        source={{ html: readerWebHtml }}
        injectedJavaScript={parityScript}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        onLoadEnd={injectOpen}
        onMessage={(event) => {
          const parsed = parseIncomingMessage(event.nativeEvent.data);
          if (!parsed) return;
          if ((parsed as { type?: string }).type === 'reader:tap') {
            onTap?.();
            return;
          }
          handleMessage(parsed);
        }}
        onError={(event) => {
          onEvent({ type: 'error', message: event.nativeEvent.description });
        }}
      />
      {selection && selectionBar ? (
        <ReaderSelectionBar
          rects={selection.rects}
          onHighlight={highlightSelection}
          onCancel={cancelSelection}
        />
      ) : null}
    </View>
  );
});

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  webView: { flex: 1, backgroundColor: palette.paper },
  });
}
