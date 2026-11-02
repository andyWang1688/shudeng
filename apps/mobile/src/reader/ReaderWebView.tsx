import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ElementRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Paths } from 'expo-file-system';
import { colors } from '../ui/theme';
import { readerFixtures } from './readerFixtures';
import { readerWebHtml } from './readerWebHtml';
import {
  mapIncomingToReaderEvent,
  openPayloadForBook,
  parseIncomingMessage,
  type IncomingMessage,
  type ReaderEvent,
  type SelectionRect,
} from './readerProtocol';
import { ReaderSelectionBar } from './ReaderSelectionBar';

export type { ReaderEvent };

type ReaderWebViewProps = {
  readonly bookId: string;
  readonly initialLocation: string | undefined;
  readonly onEvent: (event: ReaderEvent) => void;
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
export function ReaderWebView({ bookId, initialLocation, onEvent }: ReaderWebViewProps) {
  const webViewRef = useRef<ElementRef<typeof WebView>>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const openSent = useRef(false);

  const format = useMemo(() => (bookId.toLowerCase().includes('pdf') ? 'pdf' : 'epub'), [bookId]);
  const fixture = readerFixtures[format];

  const send = useCallback((message: object) => {
    const json = JSON.stringify(message);
    webViewRef.current?.injectJavaScript(`window.__readerHost && window.__readerHost(${json}); true;`);
  }, []);

  const injectOpen = useCallback(() => {
    if (openSent.current) return;
    openSent.current = true;
    const largePdfUrl = bookId === 'pdf-large-file' ? `${Paths.document.uri}large.pdf` : undefined;
    const message = JSON.stringify(openPayloadForBook(bookId, fixture, initialLocation, largePdfUrl));
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
  }, [bookId, fixture, initialLocation]);

  const handleMessage = useCallback((incoming: IncomingMessage) => {
    if (incoming.type === 'reader:selection') {
      setSelection({
        quote: incoming.payload.text,
        locator: incoming.payload.locator,
        rects: incoming.payload.rects,
      });
    }
    const event = mapIncomingToReaderEvent(incoming);
    if (event) onEvent(event);
  }, [onEvent]);

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
  }, [bookId]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        style={styles.webView}
        originWhitelist={['*']}
        source={{ html: readerWebHtml, ...(bookId === 'pdf-large-file' ? { baseUrl: Paths.document.uri } : {}) }}
        {...(bookId === 'pdf-large-file' ? { allowingReadAccessToURL: Paths.document.uri } : {})}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        onLoadEnd={injectOpen}
        onMessage={(event) => {
          const parsed = parseIncomingMessage(event.nativeEvent.data);
          if (parsed) handleMessage(parsed);
        }}
        onError={(event) => {
          onEvent({ type: 'error', message: event.nativeEvent.description });
        }}
      />
      {selection ? (
        <ReaderSelectionBar
          rects={selection.rects}
          onHighlight={highlightSelection}
          onCancel={cancelSelection}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  webView: { flex: 1, backgroundColor: colors.paper },
});
