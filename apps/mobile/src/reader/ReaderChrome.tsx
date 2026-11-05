import { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { spacing, usePalette, type Palette } from '../ui/theme';
import { useReduceMotion } from '../ui/chat/useReduceMotion';
import { NativeEpubChrome, type EpubChromeAction } from './NativeEpubChrome';

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
  readonly onSettings?: () => void;
  readonly onSearch?: () => void;
  readonly onBookmark?: () => void;
  readonly bookmarked?: boolean;
  readonly onAsk: () => void;
  readonly controlsEnabled?: boolean;
  readonly onToggleChrome?: () => void;
};

/** The native presentation port shares this RN reader's state and intents. */
export function ReaderChrome(props: ReaderChromeProps) {
  const palette = usePalette();
  if (!NativeEpubChrome) return <ReaderChromeFallback {...props} />;
  const handleAction = (action: EpubChromeAction) => {
    switch (action) {
      case 'back': props.onBack(); break;
      case 'contents': props.onAnnotations?.(); break;
      case 'settings': (props.onSettings ?? props.onMore)?.(); break;
      case 'ask': props.onAsk(); break;
      case 'bookmark': props.onBookmark?.(); break;
      case 'toggleChrome': props.onToggleChrome?.(); break;
    }
  };
  return <NativeEpubChrome
    title={props.title} chapter={props.chapter || props.title} progress={props.progressText}
    referenceMode={props.referenceMode ?? false} bookmarked={props.bookmarked ?? false}
    chromeVisible={props.visible} controlsEnabled={props.controlsEnabled ?? true} dark={palette.paper === '#1B1A17'}
    onChromeAction={event => handleAction(event.nativeEvent.action)}
    style={[StyleSheet.absoluteFill, { zIndex: 20 }]}
  />;
}

/** Portable fallback. iOS uses the UIKit 64pt toolbar and 76pt footer above. */
function ReaderChromeFallback({
  title,
  chapter,
  progressText,
  referenceMode = false,
  visible,
  controlsEnabled = true,
  annotationCount = 0,
  onBack,
  onAnnotations,
  onMore,
  onSettings,
  onSearch,
  onBookmark,
  bookmarked = false,
  onAsk,
}: ReaderChromeProps) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : 200,
      useNativeDriver: true,
    }).start();
  }, [opacity, reduceMotion, visible]);

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
            <SymbolView name="arrow.left" size={20} tintColor={palette.ink2} />
            {referenceMode ? <Text style={styles.referenceBack}>返回问答</Text> : null}
          </Pressable>
          <View style={styles.heading} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {chapter ? <Text style={styles.chapter} numberOfLines={1}>{chapter}</Text> : null}
          </View>
          <View style={styles.actions}>
            {onAnnotations ? (
              <Pressable accessibilityRole="button" accessibilityLabel="目录与书签" onPress={onAnnotations} disabled={!controlsEnabled} style={styles.iconButton}>
                <SymbolView name="list.bullet" size={19} tintColor={palette.ink2} />
              </Pressable>
            ) : null}
            {onSearch ? <Pressable accessibilityRole="button" accessibilityLabel="书内搜索" onPress={onSearch} style={styles.iconButton}><SymbolView name="magnifyingglass" size={19} tintColor={palette.ink2} /></Pressable> : null}
            {onSettings || onMore ? (
              <Pressable accessibilityRole="button" accessibilityLabel="阅读设置" onPress={onSettings ?? onMore} disabled={!controlsEnabled} style={styles.iconButton}>
                <SymbolView name="ellipsis" size={19} tintColor={palette.ink2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {onBookmark && bookmarked ? <Pressable accessibilityRole="button" accessibilityLabel="移除当前页书签" accessibilityState={{ selected: true }} onPress={onBookmark} style={[styles.ribbon, { top: insets.top + 56 }]}><SymbolView name="bookmark.fill" size={22} tintColor={palette.lamp} /></Pressable> : null}

      <View style={[styles.footer, { paddingBottom: insets.bottom, height: 76 + insets.bottom }]}>
        <Text style={styles.progress}>{progressText}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="问问书灯" onPress={onAsk} style={styles.askCapsule}>
          <SymbolView name="lightbulb" size={16} tintColor={palette.ink} />
          <Text style={styles.askText}>问问书灯</Text>
        </Pressable>
        <Text style={styles.chapterRight} numberOfLines={1}>{chapter ?? ''}</Text>
      </View>
    </Animated.View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  toolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: `${palette.paper}F0`,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
    justifyContent: 'flex-end',
  },
  toolbarRow: {
    height: 51,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: { minWidth: 88, height: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  referenceBack: { color: palette.ink2, fontSize: 12 },
  heading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  title: { color: palette.ink, fontSize: 13, fontWeight: '600', lineHeight: 17 },
  chapter: { color: palette.ink3, fontSize: 10, lineHeight: 14 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ribbon: { position: 'absolute', right: 21, width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 7, right: 3, minWidth: 12, textAlign: 'center', fontSize: 9, color: palette.paper, backgroundColor: palette.lamp, borderRadius: 6, overflow: 'hidden' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: `${palette.paper}F0`,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: 4,
  },
  progress: { width: 56, color: palette.ink3, fontSize: 11, paddingBottom: 10 },
  chapterRight: { flexShrink: 1, maxWidth: '54%', textAlign: 'right', color: palette.ink3, fontSize: 11, paddingBottom: 10 },
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
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 9,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  askText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  });
}
