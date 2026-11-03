/** 阅读器覆盖层：加载中、打开失败重试、轻提示、错误横幅。 */
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, usePalette, type Palette } from '../theme';

export function ReaderLoadingOverlay() {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.loading} pointerEvents="none">
      <ActivityIndicator color={palette.lamp} />
      <Text style={styles.loadingText}>正在打开书籍…</Text>
    </View>
  );
}

export function ReaderOpenErrorOverlay({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.error}>
      <Text style={styles.errorTitle}>无法打开阅读器</Text>
      <Text style={styles.errorDetail} numberOfLines={3}>{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="重试打开" onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>重试</Text>
      </Pressable>
    </View>
  );
}

export function ReaderNoticeToast({ message, top }: { readonly message: string; readonly top: number }) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={[styles.notice, { top }]} pointerEvents="none">
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

export function ReaderErrorBanner({ message, top, onDismiss }: {
  readonly message: string;
  readonly top: number;
  readonly onDismiss: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="关闭错误提示" onPress={onDismiss} style={[styles.banner, { top }]}>
      <Text style={styles.bannerText} numberOfLines={2}>{message}</Text>
    </Pressable>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    loading: { position: 'absolute', left: 0, right: 0, top: '40%', alignItems: 'center', gap: 10, zIndex: 25 },
    loadingText: { color: palette.ink3, fontSize: 13 },
    error: { position: 'absolute', left: spacing.lg, right: spacing.lg, top: '28%', zIndex: 30, alignItems: 'center', gap: 10, borderRadius: radius.card, backgroundColor: palette.paper, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line },
    errorTitle: { color: palette.ink, fontSize: 15, fontWeight: '600' },
    errorDetail: { color: palette.ink3, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    retryButton: { borderRadius: radius.field, backgroundColor: palette.lampWash, paddingHorizontal: spacing.lg, paddingVertical: 8 },
    retryText: { color: palette.ink, fontSize: 13, fontWeight: '600' },
    notice: { position: 'absolute', alignSelf: 'center', left: 24, right: 24, alignItems: 'center', zIndex: 30 },
    noticeText: { borderRadius: 10, backgroundColor: 'rgba(36,33,28,0.86)', color: palette.paper, fontSize: 12, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
    banner: { position: 'absolute', left: 12, right: 12, zIndex: 35, backgroundColor: palette.errorWash, paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.field },
    bannerText: { fontSize: 12, color: palette.error },
  });
}
