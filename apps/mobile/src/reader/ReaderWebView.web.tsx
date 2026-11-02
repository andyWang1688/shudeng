import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../ui/theme';
import { readerFixtures } from './readerFixtures';
import { readerWebHtml } from './readerWebHtml';
import {
  mapIncomingToReaderEvent,
  openPayloadForBook,
  parseIncomingMessage,
  type IncomingMessage,
  type ReaderAnnotationSeed,
  type ReaderEvent,
  type SelectionRect,
} from './readerProtocol';
import { ReaderSelectionBar } from './ReaderSelectionBar';

export type { ReaderEvent };

type ReaderWebViewProps = {
  readonly bookId: string;
  readonly initialAnnotations?: readonly ReaderAnnotationSeed[];
  /** 是否显示 ReaderWebView 内置选字浮层；宿主自己渲染选字栏时传 false。默认 true。 */
  readonly selectionBar?: boolean;
  readonly onEvent: (event: ReaderEvent) => void;
};

type SelectionState = {
  readonly quote: string;
  readonly locator: NonNullable<Extract<ReaderEvent, { type: 'selection' }>['locator']>;
  readonly rects: readonly SelectionRect[] | undefined;
};

/**
 * Expo Web 实现：用同源 iframe 承载同一个自包含 reader-web HTML。
 * react-native-webview 不支持 Web，iframe 能真实运行阅读器并验证协议/选字坐标。
 */
export function ReaderWebView({ bookId, initialAnnotations, selectionBar = true, onEvent }: ReaderWebViewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const format = useMemo(() => (bookId.toLowerCase().includes('pdf') ? 'pdf' : 'epub'), [bookId]);
  const fixture = readerFixtures[format];
  const openSent = useRef(false);
  const annotationsHydrated = useRef(false);

  const send = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  const injectOpen = useCallback(() => {
    if (openSent.current) return;
    openSent.current = true;
    const message = openPayloadForBook(bookId, fixture);
    let attempts = 0;
    const deliver = () => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      const host = (target as unknown as { __readerHost?: unknown }).__readerHost;
      if (typeof host === 'function') {
        target.postMessage(message, '*');
        return;
      }
      if (attempts++ < 120) window.setTimeout(deliver, 50);
    };
    deliver();
  }, [bookId, fixture]);

  const handleMessage = useCallback((incoming: IncomingMessage) => {
    if (incoming.type === 'reader:ready') {
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

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const parsed = parseIncomingMessage(event.data);
      if (parsed) handleMessage(parsed);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handleMessage]);

  useEffect(() => {
    setSelection(null);
    openSent.current = false;
    annotationsHydrated.current = false;
  }, [bookId]);

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

  return (
    <View style={styles.container}>
      <iframe
        ref={iframeRef}
        title="书灯阅读器"
        srcDoc={readerWebHtml}
        onLoad={injectOpen}
        style={iframeStyle}
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
}

const iframeStyle = {
  borderWidth: 0,
  width: '100%',
  height: '100%',
  backgroundColor: colors.paper,
} satisfies CSSProperties;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
});
