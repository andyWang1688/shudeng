import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Palette } from '../theme';
import { friendlyError } from './format';

export function ChatEmptyState() {
  return <View accessibilityLabel="还没有对话，输入问题开始" />;
}

export function ChatLoadingState({ palette }: { readonly palette: Palette }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={palette.lamp} />
      <Text style={[styles.hint, { color: palette.ink3 }]}>准备书内资料…</Text>
    </View>
  );
}

export function ChatErrorBanner({
  indexMissing,
  loadError,
  indexDetail,
  palette,
}: {
  readonly indexMissing: boolean;
  readonly loadError: string | null;
  readonly indexDetail: string;
  readonly palette: Palette;
}) {
  return (
    <View style={[styles.banner, { backgroundColor: palette.errorWash }]}>
      <Text style={[styles.title, { color: palette.error }]}>
        {indexMissing ? '这本书暂不能问答' : '暂时无法问答'}
      </Text>
      <Text style={[styles.body, { color: palette.error }]}>{friendlyError(loadError ?? indexDetail)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  hint: { fontSize: 12, lineHeight: 18 },
  banner: { borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11, gap: 2, marginBottom: 8 },
  title: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  body: { fontSize: 12, lineHeight: 18 },
});
