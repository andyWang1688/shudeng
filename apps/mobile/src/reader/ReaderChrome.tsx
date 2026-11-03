import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { colors, radius, spacing } from '../ui/theme';

export type ReaderChromeProps = {
  readonly title: string;
  readonly chapter?: string | null;
  readonly progressText: string;
  readonly referenceMode?: boolean;
  readonly visible: boolean;
  readonly annotationCount?: number;
  readonly onBack: () => void;
  readonly onAnnotations?: () => void;
  /** Swift 阅读器右上「更多」：书签等次要操作放入该菜单。 */
  readonly onMore?: () => void;
  readonly onAsk: () => void;
};

/**
 * 覆盖式阅读 chrome：51pt 顶部工具栏 + 底部中央问问书灯胶囊。
 * 内容层不因显隐改变大小；显隐用 200ms 透明度过渡，与 Swift 版覆盖控件一致。
 */
export function ReaderChrome({
  title,
  chapter,
  progressText,
  referenceMode = false,
  visible,
  annotationCount = 0,
  onBack,
  onAnnotations,
  onMore,
  onAsk,
}: ReaderChromeProps) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [opacity, visible]);

  return (
    <Animated.View style={[styles.root, { opacity }]} pointerEvents={visible ? 'box-none' : 'none'}>
      <View style={[styles.toolbar, { paddingTop: insets.top, height: 51 + insets.top }]}>
        <View style={[styles.toolbarRow, { paddingLeft: Math.max(13, insets.left), paddingRight: Math.max(13, insets.right) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={referenceMode ? '返回问答' : '书架'}
            onPress={onBack}
            style={styles.backButton}
          >
            <SymbolView name="chevron.left" size={20} tintColor={colors.ink2} />
            {referenceMode ? <Text style={styles.referenceBack}>返回问答</Text> : null}
          </Pressable>
          <View style={styles.heading} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {chapter ? <Text style={styles.chapter} numberOfLines={1}>{chapter}</Text> : null}
          </View>
          <View style={styles.actions}>
            {onAnnotations ? (
              <Pressable accessibilityRole="button" accessibilityLabel="标注" onPress={onAnnotations} style={styles.iconButton}>
                <SymbolView name="list.bullet" size={19} tintColor={colors.ink2} />
                {annotationCount > 0 ? <Text style={styles.badge}>{annotationCount}</Text> : null}
              </Pressable>
            ) : null}
            {onMore ? (
              <Pressable accessibilityRole="button" accessibilityLabel="更多" onPress={onMore} style={styles.iconButton}>
                <SymbolView name="ellipsis" size={19} tintColor={colors.ink2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom, height: 76 + insets.bottom }]}>
        <Text style={styles.progress}>{progressText}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="问问书灯" onPress={onAsk} style={styles.askCapsule}>
          <SymbolView name="lightbulb" size={16} tintColor={colors.ink} />
          <Text style={styles.askText}>问问书灯</Text>
        </Pressable>
        <Text style={styles.chapterRight} numberOfLines={1}>{chapter ?? ''}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  toolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: 'rgba(252,251,248,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    justifyContent: 'flex-end',
  },
  toolbarRow: {
    height: 51,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: { minWidth: 44, height: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  referenceBack: { color: colors.ink2, fontSize: 12 },
  heading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  title: { color: colors.ink, fontSize: 13, fontWeight: '600', lineHeight: 17 },
  chapter: { color: colors.ink3, fontSize: 10, lineHeight: 14 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 7, right: 3, minWidth: 12, textAlign: 'center', fontSize: 9, color: colors.paper, backgroundColor: colors.lamp, borderRadius: 6, overflow: 'hidden' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(252,251,248,0.94)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: 4,
  },
  progress: { width: 56, color: colors.ink3, fontSize: 11, paddingBottom: 10 },
  chapterRight: { width: 110, textAlign: 'right', color: colors.ink3, fontSize: 11, paddingBottom: 10 },
  askCapsule: {
    position: 'absolute',
    bottom: 36,
    alignSelf: 'center',
    left: '50%',
    marginLeft: -62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 9,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  askText: { fontSize: 13, fontWeight: '600', color: colors.ink },
});
