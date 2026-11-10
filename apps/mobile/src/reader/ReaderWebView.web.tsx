import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePalette, type Palette } from '../ui/theme';
import { readerFixtures } from './readerFixtures';
import { readerWebHtml } from './readerWebHtml';
import { mapIncomingToReaderEvent, openPayloadForBook, parseIncomingMessage, type ReaderAnnotationSeed } from './readerProtocol';
import type { ReaderWebViewHandle, ReaderWebViewProps } from './ReaderWebView';
export type { ReaderEvent } from './readerProtocol';

/** Web uses the same protocol and persistent annotation identities as the native WebView. */
export const ReaderWebView = memo(forwardRef<ReaderWebViewHandle, ReaderWebViewProps>(function ReaderWebView({ bookId, initialLocation, openOverride, initialAnnotations, selectionActionsEnabled = true, theme = 'light', fontScale = 1, flow = 'paginated', onEvent, onTap }, ref) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const sent = useRef(new Map<string, string>());
  const send = useCallback((message: object) => iframeRef.current?.contentWindow?.postMessage(message, '*'), []);
  useImperativeHandle(ref, () => ({
    clearSelection: () => send({ type: 'reader:selection:clear' }),
    highlightSelection: (locator, quote) => { if (selectionActionsEnabled) onEvent({ type: 'annotationAdded', locator, quote }); },
    goTo: locator => send({ type: 'reader:goTo', payload: { locator } }),
    navigate: command => send({ type: 'reader:navigate', payload: command }),
    search: (query, requestId) => send({ type: 'reader:search', payload: { query, requestId } }),
    requestContents: () => send({ type: 'reader:contents' }),
    captureBookmarkContext: (bookmarks, requestId, captureLocation) => send({ type: 'reader:bookmark-context', payload: { bookmarks, requestId, ...(captureLocation === undefined ? {} : { captureLocation }) } }),
  }), [onEvent, selectionActionsEnabled, send]);
  const open = useCallback(() => {
    if (openOverride && 'fileUri' in openOverride) {
      onEvent({ type: 'error', message: '本地 EPUB 文件需要在 App 内打开。' });
      return;
    }
    let attempts = 0;
    const deliver = () => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      if (typeof (target as unknown as { __readerHost?: unknown }).__readerHost !== 'function') {
        if (attempts++ < 120) window.setTimeout(deliver, 50);
        return;
      }
      const base = openOverride ? { type: 'reader:open', payload: { ...openOverride, url: 'inline://epub' } } : openPayloadForBook(bookId, readerFixtures.epub, initialLocation);
      send({ ...base, payload: { ...base.payload, theme, fontSize: fontScale * 18.5, flow, selectionActionsEnabled, ...(initialLocation ? { initialLocation } : {}) } });
      const doc = target.document;
      const style = doc.createElement('style');
      style.textContent = '#chrome,#footer{display:none!important} #app{padding:0!important}';
      doc.head.append(style);
    };
    setReady(false); sent.current.clear(); deliver();
  }, [bookId, flow, fontScale, initialLocation, onEvent, openOverride, selectionActionsEnabled, send, theme]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const incoming = parseIncomingMessage(event.data);
      if (!incoming) return;
      if (incoming.type === 'reader:ready') setReady(true);
      if (incoming.type === 'reader:selection' && !selectionActionsEnabled) return;
      if ((incoming as { type: string }).type === 'reader:tap') { onTap?.(); return; }
      const mapped = mapIncomingToReaderEvent(incoming);
      if (mapped) onEvent(mapped);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [onEvent, onTap, selectionActionsEnabled, send]);
  useEffect(() => {
    if (ready) send({ type: 'reader:selection:actions', payload: { enabled: selectionActionsEnabled } });
  }, [ready, selectionActionsEnabled, send]);
  useEffect(() => {
    if (!ready) return;
    const next = new Map((initialAnnotations ?? []).map((value: ReaderAnnotationSeed) => [value.id, JSON.stringify(value)]));
    for (const id of sent.current.keys()) if (!next.has(id)) send({ type: 'reader:annotation:remove', payload: { id } });
    for (const annotation of initialAnnotations ?? []) if (sent.current.get(annotation.id) !== next.get(annotation.id)) send({ type: 'reader:annotation:add', payload: annotation });
    sent.current = next;
  }, [initialAnnotations, ready, send]);
  useEffect(() => {
    if (!ready) return;
    send({ type: 'reader:theme', payload: { theme } }); send({ type: 'reader:fontSize', payload: { fontSize: fontScale * 18.5 } }); send({ type: 'reader:flow', payload: { flow } });
  }, [flow, fontScale, ready, send, theme]);
  return <View style={styles.container}><iframe ref={iframeRef} title="书灯阅读器" srcDoc={readerWebHtml} onLoad={open} style={{ ...iframeStyle, backgroundColor: palette.paper }} /></View>;
}));
const iframeStyle = { borderWidth: 0, width: '100%', height: '100%' } satisfies CSSProperties;
function makeStyles(palette: Palette) { return StyleSheet.create({ container: { flex: 1, backgroundColor: palette.paper } }); }
