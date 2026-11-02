import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ReaderWebView, type ReaderEvent } from '../reader/ReaderWebView';
import { colors, radius, spacing } from './theme';

type ReaderShellProps = {
  readonly bookId: string;
  readonly initialLocation: string | undefined;
};

export function ReaderShell({ bookId, initialLocation }: ReaderShellProps) {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [lastEvent, setLastEvent] = useState('等待 WebView 消息');

  const onReaderEvent = (event: ReaderEvent) => {
    switch (event.type) {
      case 'ready':
        setLastEvent('WebView 已就绪（消息桥已连接）');
        break;
      case 'selection':
        setLastEvent(`收到选字：${event.quote.slice(0, 32)}${event.quote.length > 32 ? '…' : ''}`);
        break;
      case 'progress':
        setProgress(event.percent);
        setLastEvent(`阅读进度 ${Math.round(event.percent * 100)}%`);
        break;
      case 'error':
        setLastEvent(`阅读器错误：${event.message}`);
        break;
    }
  };

  const bookTitle = bookId.toLowerCase().includes('pdf') ? '书灯 PDF 示例' : '红楼梦';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回书架" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ 书架</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{bookTitle}</Text>
        <View style={styles.modeChip}><Text style={styles.modeText}>WebView 壳</Text></View>
      </View>
      <ReaderWebView bookId={bookId} initialLocation={initialLocation} onEvent={onReaderEvent} />
      <View style={styles.footer}>
        <Text style={styles.footerEvent} numberOfLines={1}>{lastEvent}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(1, Math.round(progress * 100))}%` }]} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.paper,
  },
  backButton: { paddingVertical: 6, paddingRight: spacing.sm },
  backText: { fontSize: 15, color: colors.lamp },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  modeChip: { borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.xs, paddingVertical: 3 },
  modeText: { fontSize: 11, color: colors.ink2 },
  footer: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  footerEvent: { fontSize: 12, color: colors.ink3 },
  progressTrack: { marginTop: 6, height: 3, borderRadius: 2, backgroundColor: colors.paperDeep, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.lamp },
});
