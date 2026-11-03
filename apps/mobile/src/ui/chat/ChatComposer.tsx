import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { radius, type Palette } from '../theme';
import { tapFeedback } from './haptics';

export interface ChatComposerProps {
  readonly question: string;
  readonly onChangeQuestion: (value: string) => void;
  readonly placeholder: string;
  readonly running: boolean;
  readonly canSend: boolean;
  readonly inputEnabled: boolean;
  readonly configMissing: boolean;
  readonly selectionPending: boolean;
  readonly service: string;
  readonly turnsCount: number;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onOpenSettings: () => void;
  readonly palette: Palette;
}

/** 固定 composer：服务提示、胶囊输入、上下文 0%、发送/取消。 */
export function ChatComposer({
  question,
  onChangeQuestion,
  placeholder,
  running,
  canSend,
  inputEnabled,
  configMissing,
  selectionPending,
  service,
  turnsCount,
  onSend,
  onCancel,
  onOpenSettings,
  palette,
}: ChatComposerProps) {
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.composer}>
      {selectionPending ? (
        <View style={styles.composerSelection}>
          <SymbolView name="text.quote" size={13} tintColor={palette.lamp} />
          <Text style={styles.composerSelectionText}>附带选文</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole={configMissing ? 'button' : undefined}
        accessibilityLabel={configMissing ? '去设置 AI 服务' : undefined}
        onPress={configMissing ? onOpenSettings : undefined}
        style={({ pressed }) => [styles.serviceHint, pressed && styles.pressed]}
      >
        <SymbolView name="lock.shield" size={13} tintColor={palette.ink2} />
        <Text style={styles.serviceHintText}>
          发送给 {service}
          {configMissing ? ' · 去设置' : ''}
        </Text>
      </Pressable>
      <View style={styles.field}>
        <TextInput
          value={question}
          onChangeText={onChangeQuestion}
          placeholder={placeholder}
          placeholderTextColor={palette.ink3}
          multiline
          editable={!running && inputEnabled}
          style={styles.input}
        />
        {!running ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送问题"
            onPress={() => {
              tapFeedback();
              onSend();
            }}
            disabled={!canSend}
            style={({ pressed }) => [styles.sendButton, !canSend && styles.sendDisabled, pressed && styles.pressed]}
          >
            <SymbolView name="arrow.up" size={16} weight="semibold" tintColor={palette.paper} />
          </Pressable>
        ) : null}
      </View>
      {/* Swift QuestionController 的上下文用量：16pt 圆环 + caption 文案；核心 AgentRunResult
          暂无 usage 字段，当前真实可用值只有 0%（空态无上下文）。 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="上下文用量 0%"
        accessibilityHint="查看本次对话的上下文用量"
        onPress={() =>
          Alert.alert(
            '上下文用量',
            turnsCount === 0 ? '还没有开始对话，已用约 0 字。' : '当前版本暂未提供本次对话的上下文用量。',
          )
        }
        style={({ pressed }) => [styles.contextUsage, pressed && styles.pressed]}
      >
        <View style={styles.contextRing} />
        <Text style={styles.contextUsageText}>上下文 0%</Text>
      </Pressable>
      {running ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            tapFeedback();
            onCancel();
          }}
          style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
        >
          <Text style={styles.cancelText}>取消生成</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    composer: {
      paddingTop: 12,
      paddingHorizontal: 20,
      paddingBottom: 12,
      gap: 8,
      backgroundColor: palette.paper,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.line,
    },
    composerSelection: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    composerSelectionText: { fontSize: 11, color: palette.ink2 },
    serviceHint: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
    serviceHintText: { fontSize: 11, lineHeight: 16, color: palette.ink2 },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      borderRadius: radius.pill,
      backgroundColor: palette.paperDeep,
      paddingLeft: 12,
      paddingRight: 5,
      paddingVertical: 5,
    },
    input: { flex: 1, minHeight: 34, maxHeight: 92, paddingVertical: 7, fontSize: 14, lineHeight: 20, color: palette.ink },
    sendButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: palette.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendDisabled: { opacity: 0.35 },
    contextUsage: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 24 },
    contextRing: { width: 16, height: 16, borderRadius: 8, borderWidth: 2.4, borderColor: palette.line },
    contextUsageText: { fontSize: 10.5, lineHeight: 15, fontWeight: '500', color: palette.ink2 },
    cancelButton: { alignSelf: 'center', minHeight: 30, justifyContent: 'center' },
    cancelText: { fontSize: 13, lineHeight: 19, color: palette.lampInk },
    pressed: { opacity: 0.7 },
  });
}
