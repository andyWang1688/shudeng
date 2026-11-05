import { useMemo, useState } from 'react';
import { Platform, PlatformColor, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import type { AgentContextEstimate, AgentContextUsage } from '@shudeng/core';
import type { Palette } from '../theme';
import { tapFeedback } from './haptics';
import { contextBreakdown, contextPercent, contextRingSource, humanContextSize } from './contextPresentation';

export interface ChatComposerProps {
  readonly question: string;
  readonly onChangeQuestion: (value: string) => void;
  readonly selection?: Readonly<{ start: number; end: number }> | undefined;
  readonly onSelectionChange?: ((value: Readonly<{ start: number; end: number }>) => void) | undefined;
  readonly placeholder: string;
  readonly running: boolean;
  readonly canSend: boolean;
  readonly inputEnabled: boolean;
  readonly configMissing: boolean;
  readonly selectionPending: boolean;
  readonly service: string;
  readonly turnsCount: number;
  readonly contextUsage: AgentContextUsage | undefined;
  readonly contextEstimate: AgentContextEstimate | undefined;
  readonly hasExternalMaterials: boolean;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onOpenSettings: () => void;
  readonly palette: Palette;
}

/** Service settings, input, and expandable local context budget. */
export function ChatComposer({
  question, onChangeQuestion, selection, onSelectionChange, placeholder, running, canSend,
  inputEnabled, configMissing, selectionPending, service, turnsCount, contextUsage,
  contextEstimate, hasExternalMaterials, onSend, onCancel, onOpenSettings, palette,
}: ChatComposerProps) {
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const windowTokens = contextEstimate?.contextWindowTokens;
  const ratio = contextEstimate && windowTokens
    ? Math.min(1, contextEstimate.estimatedTokens / windowTokens) : undefined;
  const usageLabel = ratio !== undefined ? contextPercent(ratio)
    : contextEstimate ? contextEstimate.estimatedTokens.toLocaleString() + ' token'
      : turnsCount === 0 ? '0%' : '待统计';
  const ringSource = useMemo(() => contextRingSource(ratio, palette.line,
    ratio !== undefined && ratio >= 0.8 ? palette.error : palette.lampInk), [palette, ratio]);

  return (
    <View style={styles.composer}>
      {selectionPending ? <View style={styles.composerSelection}>
        <SymbolView name="text.quote" size={13} tintColor={palette.lamp}
          accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        <Text style={styles.composerSelectionText}>附带选文</Text>
      </View> : null}
      {!running ? <Pressable accessibilityRole="button"
        accessibilityLabel={configMissing ? '设置 AI 服务' : '发送给 ' + service}
        accessibilityHint="轻点查看或修改 AI 服务" testID="question-service-settings"
        onPress={onOpenSettings} style={({ pressed }) => [styles.serviceHint, pressed && styles.pressed]}>
        <SymbolView name="lock.shield" size={13} tintColor={palette.ink2}
          {...(Platform.OS === 'ios' ? {
            pointSize: 13,
            weight: 'regular',
            scale: 'unspecified',
            contentLayout: 'systemButton',
            style: styles.serviceIcon,
          } as const : {})}
          accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        <Text dynamicTypeRamp={Platform.OS === 'ios' ? 'caption1' : undefined}
          style={styles.serviceHintText}>发送给 {service}{configMissing ? ' · 去设置' : ''}</Text>
      </Pressable> : null}
      <View testID="question-composer-field" style={styles.field}>
        <View style={styles.inputContainer}>
          <TextInput accessibilityLabel="问题" testID="question-input" value={question}
            onChangeText={onChangeQuestion} selection={selection}
            onSelectionChange={event => onSelectionChange?.(event.nativeEvent.selection)}
            placeholder={placeholder} placeholderTextColor="transparent" selectionColor={palette.lamp} multiline
            editable={!running && inputEnabled} style={styles.input} />
          {!question ? <Text pointerEvents="none" accessible={false} accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants" dynamicTypeRamp="subheadline"
            style={styles.placeholder}>{placeholder}</Text> : null}
        </View>
        {!running ? <Pressable accessibilityRole="button" accessibilityLabel="发送问题"
          onPress={() => { tapFeedback(); onSend(); }} disabled={!canSend}
          style={({ pressed }) => [styles.sendButton, !canSend && styles.sendDisabled, pressed && styles.pressed]}>
          <SymbolView name="arrow.up" size={16} weight="semibold"
            tintColor={canSend ? palette.paper : Platform.OS === 'ios' ? PlatformColor('tertiaryLabel') : palette.ink3}
            accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </Pressable> : null}
      </View>
      {!configMissing ? <Pressable accessibilityRole="button" accessibilityLabel="上下文用量"
        accessibilityValue={{ text: usageLabel + (detailsExpanded ? '，已展开' : '，已收起') }}
        accessibilityState={Platform.OS === 'ios' ? undefined : { expanded: detailsExpanded }}
        accessibilityHint="查看本次对话的容量明细，容量与构成为本地估算，不用于计费" testID="question-context-usage"
        onPress={() => setDetailsExpanded(value => !value)}
        style={({ pressed }) => [styles.contextUsage, pressed && styles.pressed]}>
        <Image source={{ uri: ringSource }} style={styles.contextRing} accessible={false}
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants" transition={0} />
        <Text dynamicTypeRamp={Platform.OS === 'ios' ? 'caption1' : undefined}
          style={styles.contextUsageText}>上下文 {usageLabel}</Text>
      </Pressable> : null}
      {!configMissing && detailsExpanded ? <View testID="question-context-details" style={styles.contextDetails}>
        <Text testID="question-context-summary" style={styles.contextDetailsTitle}>
          {contextEstimate ? '已用约 ' + humanContextSize(contextEstimate.estimatedTokens) +
            (windowTokens ? ' / 窗口约 ' + humanContextSize(windowTokens) : ' · 窗口未设置')
            : turnsCount === 0 ? '还没有开始对话' : '本次对话尚无上下文估算记录'}
        </Text>
        {contextEstimate ? <Text testID="question-context-breakdown" style={styles.contextDetailsText}>
          {contextBreakdown(contextEstimate, hasExternalMaterials)}
        </Text> : null}
        <Text testID="question-context-status" style={styles.contextDetailsText}>
          {contextEstimate?.action === 'compacted' || (contextEstimate?.summarizedMessages ?? 0) > 0
            ? '本次对话已接近上限，已自动整理较早对话'
            : contextEstimate?.action === 'pruned' ? '更早的对话已为本次回答收起'
              : contextEstimate?.action === 'trimmed' ? '部分书内资料已精简后使用'
                : (contextEstimate?.trimmedMessages ?? 0) > 0 ? '更早的对话已为本次回答收起'
                  : (contextEstimate?.truncatedToolResults ?? 0) > 0 ? '部分书内资料已精简后使用'
              : contextEstimate ? windowTokens ? '内容仍在上限内，暂未自动整理' : '尚未设置模型上下文窗口，无法判断容量上限'
                : '发送问题后可查看本次请求的容量明细'}
        </Text>
      </View> : null}
      {running ? <Pressable accessibilityRole="button" accessibilityLabel="取消生成"
        onPress={() => { tapFeedback(); onCancel(); }}
        style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
        <Text style={styles.cancelText}>取消生成</Text>
      </Pressable> : null}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    composer: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 12, gap: 8,
      backgroundColor: palette.paper, borderTopWidth: 1, borderTopColor: palette.line },
    composerSelection: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    composerSelectionText: { fontSize: 11, color: palette.ink2 },
    serviceHint: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
    serviceIcon: { width: 17.5, height: 19.5 },
    serviceHintText: { fontSize: 11, ...(Platform.OS === 'ios' ? {} : { lineHeight: 16 }), color: palette.ink2 },
    // The native UIStackView's configured fill is absent in the accepted device
    // baseline. Keep its margins, but match the rendered paper rather than adding
    // a second visible capsule around the input and the separate send button.
    field: { flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingLeft: 12, paddingRight: 5, paddingVertical: 5 },
    inputContainer: { flex: 1, height: 44 },
    input: { height: 44, paddingTop: 10, paddingBottom: 8, paddingLeft: 11, paddingRight: 9,
      fontSize: 14, color: palette.ink, backgroundColor: 'transparent' },
    placeholder: { position: 'absolute', top: 9, left: 11, right: 9, fontSize: 13, color: palette.ink2 },
    sendButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
    sendDisabled: { backgroundColor: Platform.OS === 'ios' ? PlatformColor('tertiarySystemFill') : palette.ink + '12' },
    // Native's plain context button is sized by its 16pt image and caption.
    contextUsage: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
      ...(Platform.OS === 'ios' ? {} : { minHeight: 24 }) },
    contextRing: { width: 16, height: 16 },
    contextUsageText: { fontSize: 10.5, ...(Platform.OS === 'ios' ? {} : { lineHeight: 15 }), fontWeight: '500', color: palette.ink2 },
    contextDetails: { gap: 5, paddingVertical: 7 },
    contextDetailsTitle: { fontSize: 11, lineHeight: 16, fontWeight: '500', color: palette.ink2 },
    contextDetailsText: { fontSize: 10.5, lineHeight: 16, color: palette.ink2 },
    cancelButton: { alignSelf: 'center', minHeight: 30, justifyContent: 'center' },
    cancelText: { fontSize: 13, lineHeight: 19, color: palette.lampInk },
    pressed: { opacity: 0.7 },
  });
}
