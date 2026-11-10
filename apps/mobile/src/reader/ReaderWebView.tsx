import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
  type ReaderNavigationCommand,
  type SelectionRect,
} from './readerProtocol';
import { ReaderSelectionBar } from './ReaderSelectionBar';
import { NativeEpubSurface } from './NativeEpubSurface';
import { openReaderEpubArchive, closeReaderEpubArchive } from '../platform/epubArchive';
import type { EpubArchiveDescriptor } from '@shudeng/core';

export type { ReaderEvent };

export type ReaderOpenOverride = {
  readonly format: 'epub' | 'pdf';
  readonly title: string;
  readonly mimeType: string;
} & ({ readonly dataBase64: string } | { readonly format: 'epub'; readonly fileUri: string });

export type ReaderWebViewProps = {
  readonly bookId: string;
  readonly initialLocation: string | undefined;
  readonly openOverride: ReaderOpenOverride | undefined;
  readonly initialAnnotations?: readonly ReaderAnnotationSeed[];
  /** 是否显示 ReaderWebView 内置选字浮层；宿主自己渲染选字栏时传 false。默认 true。 */
  readonly selectionBar?: boolean;
  /** Reference pages do not create highlights, notes or selection questions. */
  readonly selectionActionsEnabled?: boolean;
  /** 阅读器主题；深色模式传 dark 让 reader-web 正文/背景切换。 */
  readonly theme?: 'light' | 'dark';
  readonly fontScale?: number;
  readonly flow?: 'paginated' | 'scrolled' | 'curl';
  readonly onTap?: () => void;
  readonly onEvent: (event: ReaderEvent) => void;
};

export type ReaderWebViewHandle = {
  highlightSelection: (locator: ReaderLocator, quote: string) => void;
  clearSelection: () => void;
  goTo: (locator: string) => void;
  navigate: (command: ReaderNavigationCommand) => void;
  search: (query: string, requestId: number) => void;
  requestContents: () => void;
  captureBookmarkContext: (bookmarks: readonly { readonly id: string; readonly locator: ReaderLocator }[], requestId: number, captureLocation?: boolean) => void;
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
export const ReaderWebView = memo(forwardRef<ReaderWebViewHandle, ReaderWebViewProps>(function ReaderWebView(
  { bookId, initialLocation, openOverride, initialAnnotations, selectionBar = true, selectionActionsEnabled = true, theme = 'light', fontScale = 1, flow = 'paginated', onTap, onEvent },
  ref,
) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const webViewRef = useRef<ElementRef<typeof WebView>>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const openSent = useRef(false);
  const [ready, setReady] = useState(false);
  const [archive, setArchive] = useState<EpubArchiveDescriptor | null>(null);
  const archiveOwner = useRef<{ archive: EpubArchiveDescriptor; fileUri: string; nativeOwnsClose: boolean } | null>(null);
  const sentAnnotations = useRef(new Map<string, string>());
  const sentPreferences = useRef<{ theme: 'light' | 'dark'; fontSize: number; flow?: 'paginated' | 'scrolled' } | null>(null);
  const initializedBook = useRef<string | null>(null);
  const nativeCommandId = useRef(0);
  const nativeAcknowledgedId = useRef(0);
  const [nativeCommands, setNativeCommands] = useState<readonly { readonly id: number; readonly message: object }[]>([]);
  const nativeCommand = useMemo(() => JSON.stringify(nativeCommands), [nativeCommands]);
  const nativeSurface = (openOverride?.format ?? (bookId.toLowerCase().includes('pdf') ? 'pdf' : 'epub')) === 'epub' && NativeEpubSurface !== null;
  const engineFlow = flow === 'scrolled' ? 'scrolled' : 'paginated';
  const fontSize = fontScale * 18.5;

  const format = useMemo(() => (bookId.toLowerCase().includes('pdf') ? 'pdf' : 'epub'), [bookId]);
  const fixture = readerFixtures[format];
  const fileUri = openOverride && 'fileUri' in openOverride ? openOverride.fileUri : null;
  const eventHandler = useRef(onEvent);
  eventHandler.current = onEvent;

  useEffect(() => {
    if (!fileUri) return;
    // React Activity can disconnect effects while retaining the native view.
    // A document already handed to that view must survive the reconnect.
    if (archiveOwner.current?.fileUri === fileUri && archiveOwner.current.nativeOwnsClose) return;
    let active = true;
    let owned: { archive: EpubArchiveDescriptor; fileUri: string; nativeOwnsClose: boolean } | null = null;
    setArchive(null);
    if (!nativeSurface) {
      eventHandler.current({ type: 'error', message: '当前安装包缺少 EPUB 文件阅读组件，请更新后重试。' });
      return;
    }
    void openReaderEpubArchive(fileUri).then(async opened => {
      if (!active) { await closeReaderEpubArchive(opened.sessionID); return; }
      owned = { archive: opened, fileUri, nativeOwnsClose: false };
      archiveOwner.current = owned;
      setArchive(opened);
    }).catch(cause => {
      if (active) eventHandler.current({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => {
      active = false;
      // A loaded native view closes in WebKit -> Foliate -> native I/O order.
      // Sessions that never reached a mounted view still need an owner here.
      if (owned && !owned.nativeOwnsClose) void closeReaderEpubArchive(owned.archive.sessionID).catch(() => {});
      if (archiveOwner.current === owned && !owned?.nativeOwnsClose) archiveOwner.current = null;
    };
  }, [fileUri, nativeSurface]);

  const parityScript = useMemo(() => `
    (function () {
      var hide = document.createElement('style');
      hide.textContent = '#chrome, #footer { display: none !important; } #app { padding: 0 !important; height: 100% !important; } #reader { height: 100vh !important; }';
      (document.head || document.documentElement).appendChild(hide);
    })();
  `, []);

  const send = useCallback((message: object) => {
    if (nativeSurface) {
      const command = { id: ++nativeCommandId.current, message };
      setNativeCommands(commands => [...commands, command]);
      return;
    }
    const json = JSON.stringify(message);
    webViewRef.current?.injectJavaScript(`window.__readerHost && window.__readerHost(${json}); true;`);
  }, [nativeSurface]);

  const injectOpen = useCallback(() => {
    if (openSent.current) return;
    if (fileUri && !archive) return;
    openSent.current = true;
    const payload = openOverride
      ? { type: 'reader:open', payload: { format: openOverride.format, url: `inline://${openOverride.format}`, title: openOverride.title, ...('dataBase64' in openOverride ? { dataBase64: openOverride.dataBase64 } : { archive }), mimeType: openOverride.mimeType, theme, fontSize, flow: engineFlow, ...(initialLocation ? { initialLocation } : {}) } }
      : { ...openPayloadForBook(bookId, fixture, initialLocation), payload: { ...openPayloadForBook(bookId, fixture, initialLocation).payload, theme, fontSize, flow: engineFlow } };
    const opening = { ...payload, payload: { ...payload.payload, selectionActionsEnabled } };
    sentPreferences.current = { theme, fontSize, ...(opening.payload.format === 'epub' ? { flow: engineFlow } : {}) };
    if (nativeSurface) { send(opening); return; }
    const message = JSON.stringify(opening);
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
  }, [archive, bookId, engineFlow, fileUri, fixture, fontSize, initialLocation, nativeSurface, openOverride, selectionActionsEnabled, send, theme]);

  useImperativeHandle(ref, () => ({
    highlightSelection: (locator: ReaderLocator, quote: string) => { if (selectionActionsEnabled) onEvent({ type: 'annotationAdded', locator, quote }); },
    clearSelection: () => {
      send({ type: 'reader:selection:clear' });
      setSelection(null);
    },
    goTo: (locator: string) => send({ type: 'reader:goTo', payload: { locator } }),
    navigate: command => send({ type: 'reader:navigate', payload: command }),
    search: (query: string, requestId: number) => send({ type: 'reader:search', payload: { query, requestId } }),
    requestContents: () => send({ type: 'reader:contents' }),
    captureBookmarkContext: (bookmarks, requestId, captureLocation) => send({ type: 'reader:bookmark-context', payload: { bookmarks, requestId, ...(captureLocation === undefined ? {} : { captureLocation }) } }),
  }), [onEvent, selectionActionsEnabled, send]);

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
      setReady(true);
    }
    if (incoming.type === 'reader:selection') {
      if (!selectionActionsEnabled) { setSelection(null); return; }
      setSelection({
        quote: incoming.payload.text,
        locator: incoming.payload.locator,
        rects: incoming.payload.rects,
      });
    }
    if (incoming.type === 'reader:selectionCleared') setSelection(null);
    const event = mapIncomingToReaderEvent(incoming);
    if (event) onEvent(event);
  }, [onEvent, selectionActionsEnabled, send]);

  useEffect(() => {
    if (!selectionActionsEnabled) setSelection(null);
    if (ready) send({ type: 'reader:selection:actions', payload: { enabled: selectionActionsEnabled } });
  }, [ready, selectionActionsEnabled, send]);

  useEffect(() => {
    if (!ready) return;
    const next = new Map((initialAnnotations ?? []).map(annotation => [annotation.id, JSON.stringify(annotation)]));
    for (const id of sentAnnotations.current.keys()) {
      if (!next.has(id)) send({ type: 'reader:annotation:remove', payload: { id } });
    }
    for (const annotation of initialAnnotations ?? []) {
      if (sentAnnotations.current.get(annotation.id) !== next.get(annotation.id)) send({ type: 'reader:annotation:add', payload: annotation });
    }
    sentAnnotations.current = next;
  }, [initialAnnotations, ready, send]);

  useEffect(() => {
    if (!ready || initializedBook.current !== bookId) return;
    const previous = sentPreferences.current;
    if (previous?.theme !== theme) send({ type: 'reader:theme', payload: { theme } });
    if (previous?.fontSize !== fontSize) send({ type: 'reader:fontSize', payload: { fontSize } });
    if (previous?.flow !== engineFlow) send({ type: 'reader:flow', payload: { flow: engineFlow } });
    sentPreferences.current = { theme, fontSize, flow: engineFlow };
  }, [bookId, engineFlow, fontSize, ready, send, theme]);

  const highlightSelection = useCallback(() => {
    if (selectionActionsEnabled && selection) onEvent({ type: 'annotationAdded', locator: selection.locator, quote: selection.quote });
  }, [onEvent, selection, selectionActionsEnabled]);

  const cancelSelection = useCallback(() => {
    send({ type: 'reader:selection:clear' });
    setSelection(null);
  }, [send]);

  useEffect(() => {
    if (initializedBook.current === bookId) return;
    initializedBook.current = bookId;
    setSelection(null);
    openSent.current = false;
    setReady(false);
    sentAnnotations.current.clear();
    sentPreferences.current = null;
  }, [bookId]);

  return (
    <View style={styles.container}>
      {nativeSurface && NativeEpubSurface && (!fileUri || archive) ? <NativeEpubSurface
        archiveSessionID={archive?.sessionID ?? ''}
        html={readerWebHtml} command={nativeCommand} curl={flow === 'curl'} dark={theme === 'dark'} style={styles.webView}
        onEpubEvent={({ nativeEvent }) => {
          const value: unknown = JSON.parse(nativeEvent.message);
          if (typeof value !== 'object' || value === null) return;
          const native = value as { type?: string; payload?: { id?: number } };
          if (native.type === 'native:loaded') {
            const owner = archiveOwner.current;
            if (owner && owner.archive.sessionID === archive?.sessionID) owner.nativeOwnsClose = true;
            injectOpen();
            return;
          }
          if (native.type === 'native:ack' && typeof native.payload?.id === 'number') {
            const id = native.payload.id;
            if (id <= nativeAcknowledgedId.current) return;
            nativeAcknowledgedId.current = id;
            // ACK confirms receipt into the native queue, not execution.
            setNativeCommands(commands => commands.some(command => command.id <= id) ? commands.filter(command => command.id > id) : commands);
            return;
          }
          if (native.type === 'reader:tap') { onTap?.(); return; }
          const parsed = parseIncomingMessage(value);
          if (parsed) handleMessage(parsed);
        }}
      /> : !fileUri ? <WebView
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
      /> : null}
      {selection && selectionBar && selectionActionsEnabled ? (
        <ReaderSelectionBar
          rects={selection.rects}
          onHighlight={highlightSelection}
          onCancel={cancelSelection}
        />
      ) : null}
    </View>
  );
}));

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.paper },
  webView: { flex: 1, backgroundColor: palette.paper },
  });
}
