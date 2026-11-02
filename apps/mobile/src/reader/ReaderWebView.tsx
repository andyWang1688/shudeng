import { useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, spacing } from '../ui/theme';

export type ReaderEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'selection'; readonly quote: string }
  | { readonly type: 'progress'; readonly percent: number };

type ReaderWebViewProps = {
  readonly bookId: string;
  readonly onEvent: (event: ReaderEvent) => void;
};

type ReaderWebViewHandle = React.ElementRef<typeof WebView>;

/** WebView 阅读器壳：只验证 iOS/Android 能承载网页阅读器并通过消息协议通信。 */
export function ReaderWebView({ bookId, onEvent }: ReaderWebViewProps) {
  const webViewRef = useRef<ReaderWebViewHandle>(null);
  const html = useMemo(() => readerHtml(bookId), [bookId]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.webFallback}>
        <Text style={styles.webFallbackText}>WebView 阅读器壳只在 iOS / Android 运行；Web 预览为占位。</Text>
      </View>
    );
  }

  return (
    <WebView
      ref={webViewRef}
      style={styles.webView}
      originWhitelist={['*']}
      source={{ html }}
      javaScriptEnabled
      domStorageEnabled
      onMessage={(event) => {
        const parsed = parseReaderEvent(event.nativeEvent.data);
        if (parsed !== null) onEvent(parsed);
      }}
    />
  );
}

export function parseReaderEvent(raw: string): ReaderEvent | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.type === 'ready') return { type: 'ready' };
    if (record.type === 'selection' && typeof record.quote === 'string') {
      return { type: 'selection', quote: record.quote };
    }
    if (record.type === 'progress' && typeof record.percent === 'number') {
      return { type: 'progress', percent: Math.min(1, Math.max(0, record.percent)) };
    }
    return null;
  } catch {
    return null;
  }
}

function readerHtml(bookId: string): string {
  const isPdf = bookId.toLowerCase().includes('pdf');
  const title = isPdf ? '书灯 PDF 示例 · 第一页' : '红楼梦 · 第三回';
  const paragraphs = isPdf
    ? ['灯把书页照亮，也把问题留在纸上。The lamp lights the page.', 'PDF 阅读器由 WebView 承载的 pdf.js 负责（后续 spike 验证）。']
    : ['黛玉方进入房时，只见两个人搀着一位鬓发如银的老母迎上来。', '灯把书页照亮，也把问题留在纸上。读者没有读懂的那一句，往往正需要停一停。'];
  const body = paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #F7F3EA; color: #24211C; }
  body { font: 17px/1.75 "Songti SC", "Noto Serif CJK SC", serif; padding: 28px 24px 120px; }
  h1 { font-size: 22px; line-height: 1.5; margin: 0 0 20px; }
  p { margin: 0 0 18px; }
  .hint { color: #948D80; font: 13px/1.6 -apple-system, BlinkMacSystemFont, sans-serif; }
  .toolbar { position: fixed; left: 24px; right: 24px; bottom: 28px; display: flex; gap: 10px; }
  button { flex: 1; border: 0; border-radius: 12px; padding: 12px; font: 14px -apple-system, BlinkMacSystemFont, sans-serif; background: #F4E3C2; color: #24211C; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
<p class="hint">WebView 消息壳：选字后点按下方按钮，把引用发回 RN 层。</p>
<div class="toolbar"><button id="report">报告选字</button><button id="scroll-top" style="background:#EDE6D8">回到顶部</button></div>
<script>
  const post = (type, payload) => {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type }, payload)));
  };
  post('ready');
  document.getElementById('report').addEventListener('click', () => {
    const selection = window.getSelection();
    const quote = selection ? selection.toString().trim() : '';
    post('selection', { quote: quote || '灯把书页照亮，也把问题留在纸上。' });
  });
  document.getElementById('scroll-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', () => {
    const max = document.body.scrollHeight - window.innerHeight;
    post('progress', { percent: max > 0 ? scrollY / max : 0 });
  }, { passive: true });
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

const styles = StyleSheet.create({
  webView: { flex: 1, backgroundColor: colors.paper },
  webFallback: { flex: 1, padding: spacing.lg, justifyContent: 'center', backgroundColor: colors.paper },
  webFallbackText: { color: colors.ink3, fontSize: 14, lineHeight: 22, textAlign: 'center' },
});
