import { memo, useMemo, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { radius, type Palette } from '../theme';
import { citationTitle, locatorForCitation, SERIF, SERIF_BOLD, toolLabel } from './format';
import { tapFeedback } from './haptics';
import type { ChatTurn } from './types';

export const AssistantTurn = memo(function AssistantTurn({
  turn,
  bookId,
  bookTitle,
  format,
  palette,
  onRetry,
}: {
  readonly turn: ChatTurn;
  readonly bookId: string;
  readonly bookTitle: string;
  readonly format: 'epub' | 'pdf';
  readonly palette: Palette;
  readonly onRetry: (turn: ChatTurn) => void;
}) {
  const router = useRouter();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);

  return (
    <View style={styles.block}>
      <View style={styles.identityRow}>
        <View style={styles.identityMark}>
          <SymbolView name="lightbulb" size={13} weight="medium" tintColor={palette.lamp} />
        </View>
        <Text style={styles.identityText}>书灯 · AI</Text>
      </View>

      {turn.reasoning || turn.tools.length > 0 ? (
        <View style={styles.processBox}>
          {turn.reasoning ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  tapFeedback();
                  setReasoningExpanded((value) => !value);
                }}
                style={({ pressed }) => [styles.processHeader, pressed && styles.pressed]}
              >
                <SymbolView
                  name={reasoningExpanded ? 'chevron.down' : 'chevron.right'}
                  size={11}
                  tintColor={palette.ink2}
                />
                <Text style={styles.processTitle}>
                  {turn.status === 'streaming' && !turn.text ? '正在思考' : '已思考'}
                </Text>
              </Pressable>
              {reasoningExpanded ? <Text style={styles.reasoningText}>{turn.reasoning}</Text> : null}
            </>
          ) : null}
          {turn.tools.length > 0 ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  tapFeedback();
                  setToolsExpanded((value) => !value);
                }}
                style={({ pressed }) => [styles.processHeader, pressed && styles.pressed]}
              >
                <SymbolView
                  name={toolsExpanded ? 'chevron.down' : 'chevron.right'}
                  size={11}
                  tintColor={palette.ink2}
                />
                <Text style={styles.processTitle}>
                  {turn.status === 'streaming'
                    ? `正在查书 · 已完成 ${turn.tools.filter((tool) => tool.status !== 'running').length} 步`
                    : `查书 ${turn.tools.length} 步`}
                </Text>
              </Pressable>
              {toolsExpanded ? (
                <View style={styles.toolList}>
                  {turn.tools.map((tool) => (
                    <View key={tool.callId} style={styles.toolRow}>
                      <Text style={styles.toolDot}>
                        {tool.status === 'error' ? '!' : tool.status === 'running' ? '…' : '✓'}
                      </Text>
                      <Text style={styles.toolText}>
                        {toolLabel(tool.name)}
                        {tool.detail ? ` · ${tool.detail}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {turn.status === 'streaming' && !turn.text ? (
        <View style={styles.skeleton}>
          <View style={[styles.skeletonBar, { width: '82%' }]} />
          <View style={[styles.skeletonBar, { width: '100%' }]} />
          <View style={[styles.skeletonBar, { width: '62%' }]} />
        </View>
      ) : turn.text ? (
        <Text style={styles.answerText}>{turn.text}</Text>
      ) : null}

      {turn.citations.length > 0 ? (
        <View style={styles.citations}>
          <Text style={styles.citationHeading}>
            书内依据 {turn.citations.map((_, index) => `[${index + 1}]`).join(' ')}
          </Text>
          {turn.citations.map((citation, index) => {
            const locator = locatorForCitation(citation);
            return (
              <Pressable
                key={citation.id}
                accessibilityRole="button"
                accessibilityLabel={`查看原文：${citation.chapter ?? '原文'}`}
                onPress={() => {
                  if (!locator) return;
                  tapFeedback();
                  router.push({ pathname: '/reader/[id]', params: { id: bookId, locator } });
                }}
                style={({ pressed }) => [styles.citationCard, pressed && styles.pressed]}
              >
                <Text style={styles.citationTitle}>{citationTitle(citation, index, bookTitle, format)}</Text>
                <SymbolView name="arrow.up.right" size={18} tintColor={palette.ink2} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {turn.text.length > 0 ? (
        <View style={styles.answerFooter}>
          <Text style={styles.answerHint}>解释供参考，可回原文核查</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="复制回答"
            onPress={() => {
              tapFeedback();
              void Share.share({ message: turn.text });
            }}
            style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
          >
            <SymbolView name="doc.on.doc" size={15} tintColor={palette.ink2} />
          </Pressable>
        </View>
      ) : null}

      {turn.status === 'error' || turn.status === 'cancelled' ? (
        <View style={styles.recovery}>
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>回答未完成</Text>
            <Text style={styles.statusBody}>
              {turn.status === 'cancelled'
                ? '已中断，回答可能不完整。问题与选文已保留，请重试。'
                : turn.error ?? '暂时没能连接 AI 服务，问题与选文已保留，请重试。'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              tapFeedback();
              onRetry(turn);
            }}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <SymbolView name="arrow.clockwise" size={16} tintColor={palette.lampInk} />
            <Text style={styles.retryText}>重试回答</Text>
          </Pressable>
        </View>
      ) : null}

      {turn.status === 'streaming' && !turn.text && (turn.reasoning || turn.tools.length > 0) ? (
        <View style={styles.statusCardGenerating}>
          <Text style={styles.statusBodyGenerating}>正在生成</Text>
        </View>
      ) : null}

      {turn.status === 'done' || turn.status === 'error' || turn.status === 'cancelled' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            tapFeedback();
            Alert.alert('更多', '回答仅依据本次书内检索结果，可回原文核对。');
          }}
          style={({ pressed }) => [styles.moreRow, pressed && styles.pressed]}
        >
          <SymbolView name="ellipsis" size={13} tintColor={palette.ink2} />
          <Text style={styles.moreText}>更多</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

function createStyles(palette: Palette) {
  return StyleSheet.create({
    block: { gap: 9 },
    identityRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    identityMark: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: palette.lampWash,
      alignItems: 'center',
      justifyContent: 'center',
    },
    identityText: { fontSize: 12, lineHeight: 16, color: palette.ink2 },
    processBox: { gap: 6 },
    processHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 24 },
    processTitle: { fontSize: 12, lineHeight: 17, color: palette.ink2 },
    reasoningText: { fontSize: 12, lineHeight: 19, color: palette.ink2, paddingLeft: 16 },
    toolList: { gap: 3, paddingLeft: 16 },
    toolRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    toolDot: { fontSize: 11, lineHeight: 17, color: palette.ink3 },
    toolText: { flex: 1, fontSize: 11, lineHeight: 17, color: palette.ink3 },
    skeleton: { gap: 8, paddingVertical: 2 },
    skeletonBar: { height: 10, borderRadius: 4, backgroundColor: palette.line },
    answerText: { fontFamily: SERIF, fontSize: 15, lineHeight: 28, color: palette.ink },
    citations: { gap: 8, marginTop: 8 },
    citationHeading: { fontFamily: SERIF_BOLD, fontSize: 15, lineHeight: 22, color: palette.ink, marginBottom: 1 },
    citationCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: palette.surface,
      borderRadius: radius.field,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      paddingVertical: 11,
      paddingHorizontal: 12,
    },
    citationTitle: { flex: 1, fontSize: 12, lineHeight: 19, color: palette.ink },
    answerFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    answerHint: { flex: 1, fontSize: 10, lineHeight: 16, color: palette.ink2 },
    copyButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    recovery: { gap: 8 },
    statusCard: { backgroundColor: palette.errorWash, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11, gap: 2 },
    statusTitle: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: palette.error },
    statusBody: { fontSize: 12, lineHeight: 18, color: palette.error },
    statusCardGenerating: {
      backgroundColor: palette.paperDeep,
      borderRadius: 12,
      paddingVertical: 9,
      paddingHorizontal: 11,
    },
    statusBodyGenerating: { fontSize: 12, lineHeight: 18, color: palette.ink2 },
    retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
    retryText: { fontSize: 13, lineHeight: 18, color: palette.lampInk },
    moreRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 30 },
    moreText: { fontSize: 11, lineHeight: 16, color: palette.ink2 },
    pressed: { opacity: 0.7 },
  });
}
