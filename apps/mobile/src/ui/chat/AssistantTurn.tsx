import { cloneElement, isValidElement, memo, useEffect, useMemo, useState, type ElementRef, type ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Markdown, { renderRules as defaultMarkdownRules, type ASTNode, type RenderRules } from 'react-native-markdown-display';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { MenuView } from '@expo/ui/community/menu';
import { radius, type Palette } from '../theme';
import { citationTitle, locatorForCitation, SERIF, SERIF_BOLD } from './format';
import { tapFeedback } from './haptics';
import type { ChatTurn } from './types';
import type { CitationTarget, QuestionPresentation } from '../reader-question/session';
import { readerLocatorFromLegacy, storedLocatorFromUnknown } from '../../platform/library/pure';
import { nativeToolTitle, readerStepPreview } from './toolPresentation';
import { questionMaterials } from './materialsPresentation';

function isBodyParagraph(parents: readonly ASTNode[]): boolean {
  const paragraph = parents.findIndex(node => node.type === 'paragraph');
  return paragraph >= 0 && parents[paragraph + 1]?.type === 'body';
}

/** Keep inline styling/actions when a native paragraph starts at a source newline. */
function paragraphLines(nodes: readonly ASTNode[], children: readonly ReactNode[]): ReactNode[][] {
  const lines: ReactNode[][] = [[]];
  for (const [index, node] of nodes.entries()) {
    const child = children[index];
    if (node.type === 'softbreak' || node.type === 'hardbreak') {
      lines.push([]);
    } else if (node.children.length > 0 && isValidElement<{ children?: ReactNode }>(child)) {
      const nested = child.props.children;
      const segments = paragraphLines(node.children, Array.isArray(nested) ? nested : [nested]);
      if (segments.length === 1) lines[lines.length - 1]!.push(child);
      else segments.forEach((segment, line) => {
        if (line > 0) lines.push([]);
        lines[lines.length - 1]!.push(cloneElement(child, { key: node.key + '-line-' + line }, segment));
      });
    } else {
      lines[lines.length - 1]!.push(child);
    }
  }
  return lines;
}

// Markdown's inherited text-style whitelist omits lineSpacing. Apply it to the
// actual Text nodes, and keep existing non-body block rendering unchanged.
const nativeBodyMarkdownRules: RenderRules = {
  text: (node, children, parents, styles, inherited = {}) => {
    if (!isBodyParagraph(parents)) return defaultMarkdownRules.text!(node, children, parents, styles, inherited);
    const { lineHeight: _fixedLineHeight, ...bodyStyle } = inherited;
    return <Text key={node.key} style={[bodyStyle, styles.text, { lineSpacing: 5 }]}>{node.content}</Text>;
  },
  code_inline: (node, children, parents, styles, inherited = {}) => {
    if (!isBodyParagraph(parents)) return defaultMarkdownRules.code_inline!(node, children, parents, styles, inherited);
    const { lineHeight: _fixedLineHeight, ...bodyStyle } = inherited;
    return <Text key={node.key} style={[bodyStyle, styles.code_inline, { lineSpacing: 5 }]}>{node.content}</Text>;
  },
  textgroup: (node, children, parents, styles) => {
    // A hard break can make markdown-display insert textgroups inside another
    // inline run. Only block-root groups own Views/paragraph spacing; nested
    // groups stay Text so no layout View is introduced inside a native Text.
    const blockRoot = parents[0]?.type === 'paragraph' || parents[0]?.type === 'blocklink';
    if (!isBodyParagraph(parents) || !blockRoot) return defaultMarkdownRules.textgroup!(node, children, parents, styles);
    const followsHardBreak = parents[0]?.children[node.index - 1]?.type === 'hardbreak';
    // Native agentAnswerText uses paragraphSpacingBefore=5 for consecutive
    // nonempty source lines. Blank-separated paragraphs start with zero before.
    return <View key={node.key} style={{ width: '100%' }}>
      {paragraphLines(node.children, children).map((line, index) => (
        <Text key={node.key + '-paragraph-' + index} dynamicTypeRamp="body"
          style={[styles.textgroup, { lineSpacing: 5, marginTop: index > 0 || followsHardBreak ? 5 : 0 }]}>{line}</Text>
      ))}
    </View>;
  },
  paragraph: (node, children, parents, styles) => parents[0]?.type === 'body'
    ? <View key={node.key} style={[styles._VIEW_SAFE_paragraph, { marginTop: 0, marginBottom: 0 }]}>{children}</View>
    : defaultMarkdownRules.paragraph!(node, children, parents, styles),
  // markdown-display splits a hard break into adjacent textgroups. The next
  // group's before-spacing replaces its standalone newline element.
  hardbreak: (node, children, parents, styles) => isBodyParagraph(parents)
    ? null : defaultMarkdownRules.hardbreak!(node, children, parents, styles),
};

// Foundation whitespacesAndNewlines also includes U+200B, but excludes U+FEFF.
function trimReasoningText(text: string): string {
  return text.replace(/^[\p{White_Space}\u200B]+|[\p{White_Space}\u200B]+$/gu, '');
}

function displayReasoningText(text: string): string {
  return trimReasoningText(text
    .replace(/\[E\p{Nd}+\]/gu, '')
    .replace(/\*\*([^\n\r\u000B\u000C\u0085\u2028\u2029]+?)\*\*/g, '$1'));
}

function thinkingTitle(turn: ChatTurn): string {
  if (turn.status === 'streaming') return '正在思考';
  if (turn.status === 'interrupted') return '思考失败';
  if (turn.status === 'cancelled' || turn.status === 'error') {
    return turn.status === 'cancelled' || /取消|停止/.test(turn.error ?? '') ? '已停止思考' : '思考失败';
  }
  const duration = turn.reasoningDurationMs;
  return duration !== undefined && Number.isFinite(duration) && duration >= 1000
    ? `已思考（用时 ${Math.round(duration / 1000)} 秒）` : '已思考';
}

export const AssistantTurn = memo(function AssistantTurn({
  turn,
  bookId,
  bookTitle,
  format,
  sourceAvailable,
  palette,
  onRetry,
  presentation,
  onOpenCitation,
  reasoningExpanded: controlledReasoningExpanded,
  toolsExpanded: controlledToolsExpanded,
  onCitationElement,
}: {
  readonly turn: ChatTurn;
  readonly bookId: string;
  readonly bookTitle: string;
  readonly format: 'epub' | 'pdf';
  readonly sourceAvailable: boolean;
  readonly palette: Palette;
  readonly onRetry: (turn: ChatTurn) => void;
  readonly presentation?: QuestionPresentation | undefined;
  readonly onOpenCitation?: ((target: CitationTarget) => void) | undefined;
  readonly reasoningExpanded?: boolean | undefined;
  readonly toolsExpanded?: boolean | undefined;
  readonly onCitationElement?: ((key: string, element: ElementRef<typeof View> | null) => void) | undefined;
}) {
  const router = useRouter();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [localReasoningExpanded, setReasoningExpanded] = useState(false);
  const [localToolsExpanded, setToolsExpanded] = useState(false);
  const reasoningExpanded = controlledReasoningExpanded ?? localReasoningExpanded;
  const toolsExpanded = controlledToolsExpanded ?? localToolsExpanded;
  const materials = questionMaterials(turn);
  const hasReasoning = trimReasoningText(turn.reasoning).length > 0;
  const reasoningTitle = thinkingTitle(turn);
  const toolProblems = turn.tools.filter(tool => tool.status === 'error').length;
  const toolsBaseTitle = turn.status === 'streaming'
    ? `正在查书 · 已完成 ${turn.tools.filter(tool => tool.finished ?? tool.status !== 'running').length} 步`
    : turn.toolSummary || `查书 ${turn.tools.length} 步`;
  const toolsTitle = toolsBaseTitle + (toolProblems > 0 ? ` · ${toolProblems} 步未完成` : '');
  const markdownStyles = useMemo(
    () => ({
      body: { fontFamily: SERIF, fontSize: 15, lineHeight: 28, color: palette.ink },
      heading1: {
        fontFamily: SERIF_BOLD,
        fontSize: 22,
        lineHeight: 31,
        marginTop: 14,
        marginBottom: 8,
        color: palette.ink,
      },
      heading2: {
        fontFamily: SERIF_BOLD,
        fontSize: 19,
        lineHeight: 29,
        marginTop: 12,
        marginBottom: 6,
        color: palette.ink,
      },
      heading3: {
        fontFamily: SERIF_BOLD,
        fontSize: 17,
        lineHeight: 27,
        marginTop: 10,
        marginBottom: 5,
        color: palette.ink,
      },
      strong: { fontFamily: SERIF_BOLD },
      paragraph: { marginTop: 0, marginBottom: 10 },
      code_inline: {
        fontFamily: 'Menlo',
        fontSize: 13,
        backgroundColor: palette.paperDeep,
        color: palette.ink,
      },
      fence: {
        fontFamily: 'Menlo',
        fontSize: 12,
        lineHeight: 19,
        backgroundColor: palette.paperDeep,
        color: palette.ink,
        borderColor: palette.line,
      },
      blockquote: { backgroundColor: palette.surface, borderLeftColor: palette.lamp, borderLeftWidth: 2 },
      link: { color: palette.lampInk },
    }),
    [palette],
  );
  useEffect(() => {
    const defaultExpanded = turn.legacyNative?.reasoningExpanded ?? turn.legacyNative?.agent?.reasoningExpanded ?? turn.status === 'streaming';
    if (!presentation) { setReasoningExpanded(defaultExpanded); return; }
    const view = presentation.getSnapshot();
    if (view.reasoningStatus[turn.id] === turn.status) return;
    presentation.update({
      reasoningStatus: { ...view.reasoningStatus, [turn.id]: turn.status },
      expandedReasoning: view.reasoningManual.includes(turn.id) ? view.expandedReasoning : defaultExpanded
        ? [...new Set([...view.expandedReasoning, turn.id])]
        : view.expandedReasoning.filter(id => id !== turn.id),
    });
  }, [presentation, turn.id, turn.status, turn.legacyNative, Boolean(turn.reasoning)]);

  return (
    <View style={styles.block}>
      <View style={styles.identityRow}>
        <View style={styles.identityMark}>
          <SymbolView name="lightbulb" size={Platform.OS === 'ios' ? 18 : 13} pointSize={13} weight="medium" scale="unspecified"
            contentLayout="bounds" resizeMode="scaleAspectFit" tintColor={palette.lamp}
            accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </View>
        <Text dynamicTypeRamp="caption1" style={styles.identityText}>书灯 · AI</Text>
      </View>

      {hasReasoning || turn.tools.length > 0 || turn.warnings.length > 0 ? (
        <View style={styles.processBox}>
          {hasReasoning ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={reasoningTitle}
                accessibilityState={Platform.OS === 'ios' ? undefined : { expanded: reasoningExpanded }}
                accessibilityValue={{ text: reasoningExpanded ? '已展开' : '已收起' }}
                accessibilityHint="展开或收起思考过程"
                testID={`question-thinking-toggle-${turn.id}`}
                onPress={() => {
                  tapFeedback();
                  if (presentation) presentation.toggle('expandedReasoning', turn.id);
                  else setReasoningExpanded((value) => !value);
                }}
                style={({ pressed }) => [styles.processHeader, pressed && styles.pressed]}
              >
                <Text dynamicTypeRamp="footnote" style={styles.thinkingTitle}>{reasoningTitle}</Text>
                <SymbolView
                  accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                  name={reasoningExpanded ? 'chevron.down' : 'chevron.right'}
                  size={11}
                  {...(Platform.OS === 'ios' ? {
                    pointSize: 12,
                    weight: 'semibold',
                    scale: 'unspecified',
                    contentLayout: 'systemButton',
                    style: reasoningExpanded ? styles.thinkingChevronDown : styles.thinkingChevronRight,
                  } as const : {})}
                  tintColor={Platform.OS === 'ios' ? palette.ink3 : palette.ink2}
                />
              </Pressable>
            </>
          ) : null}
          {turn.tools.length > 0 ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toolsTitle}
                accessibilityState={Platform.OS === 'ios' ? undefined : { expanded: toolsExpanded }}
                accessibilityValue={{ text: toolsExpanded ? '已展开' : '已收起' }}
                accessibilityHint="展开或收起查书步骤"
                testID={`question-agent-toggle-${turn.id}`}
                onPress={() => {
                  tapFeedback();
                  if (presentation) presentation.toggle('expandedTools', turn.id);
                  else setToolsExpanded((value) => !value);
                }}
                style={({ pressed }) => [styles.processHeader, pressed && styles.pressed]}
              >
                <Text dynamicTypeRamp="footnote" style={styles.processTitle}>{toolsTitle}</Text>
                <SymbolView
                  accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                  name={toolsExpanded ? 'chevron.down' : 'chevron.right'}
                  size={11}
                  tintColor={palette.ink2}
                />
              </Pressable>
            </>
          ) : null}
          {(hasReasoning && reasoningExpanded) || (turn.tools.length > 0 && toolsExpanded) ? (
            <View style={styles.processContent}>
              {hasReasoning && reasoningExpanded ? <Text testID={`question-thinking-${turn.id}`} dynamicTypeRamp="footnote" style={styles.reasoningText}>{displayReasoningText(turn.reasoning)}</Text> : null}
              {turn.tools.length > 0 && toolsExpanded ? (
                <View style={styles.toolList}>
                  {turn.tools.map((tool, index) => {
                    const title = (tool.title ?? nativeToolTitle(tool.name)) + (tool.detail ? ` · ${tool.detail}` : '');
                    const preview = readerStepPreview(tool.preview ?? '');
                    const finished = tool.finished ?? tool.status !== 'running';
                    return <View key={tool.callId} style={styles.toolContainer}>
                      <View testID={`question-agent-step-${turn.id}-${index}`} accessibilityLabel={title} style={styles.toolRow}>
                        <View style={[styles.toolDot, { backgroundColor: tool.status === 'error' ? palette.error : finished ? palette.lamp : palette.ink3 }]} />
                        <Text dynamicTypeRamp="footnote" style={[styles.toolText, tool.status === 'error' && { color: palette.error }]}>{title}</Text>
                      </View>
                      {preview ? <Text dynamicTypeRamp="caption1" style={styles.toolPreview} numberOfLines={3}>{preview}</Text> : null}
                    </View>;
                  })}
                </View>
              ) : null}
              {turn.contextEstimate ? (
                <Text testID={`question-agent-context-${turn.id}`} dynamicTypeRamp="caption1" style={styles.contextText}>
                  {`本次参考约 ${turn.contextEstimate.characterCount} 字 · 查书 ${Math.max(1, turn.modelSteps ?? 0)} 步`}
                </Text>
              ) : null}
            </View>
          ) : null}
          {turn.warnings.length > 0 ? (
            <View style={turn.tools.length > 0 ? undefined : styles.warningBanner}>
              <Text testID={`question-agent-warning-${turn.id}`} dynamicTypeRamp="caption1" style={styles.warningText}>
                {turn.warnings.join('\n')}
              </Text>
            </View>
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
        <Markdown style={markdownStyles} {...(Platform.OS === 'ios' ? { rules: nativeBodyMarkdownRules } : {})}>{turn.text}</Markdown>
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
                ref={node => onCitationElement?.(`${turn.id}:${citation.id}`, node)}
                accessibilityRole="button"
                accessibilityLabel={`查看原文：${citation.chapter ?? '原文'}`}
                accessibilityHint={
                  sourceAvailable ? '长按查看保存的原文片段' : '原书已移除，查看保存的原文片段'
                }
                onLongPress={() => Alert.alert('保存的原文片段', citation.quote)}
                onPress={() => {
                  if (!sourceAvailable) {
                    Alert.alert(
                      '保存的原文片段',
                      citation.quote + '\n\n原书已移除，重新导入后可回到书中核查。',
                    );
                    return;
                  }
                  if (!locator) {
                    Alert.alert(
                      '无法定位原文',
                      '该引用没有可用的阅读位置。原文仍可在这里核查：\n\n' + citation.quote,
                    );
                    return;
                  }
                  tapFeedback();
                  if (onOpenCitation) {
                    let parsed: unknown;
                    try { parsed = JSON.parse(locator); } catch { parsed = { type: 'epub', cfi: locator }; }
                    const target = storedLocatorFromUnknown(parsed) ?? readerLocatorFromLegacy(locator, format === 'pdf' ? 'PDF' : 'EPUB');
                    if (!target) { Alert.alert('无法定位原文', '该引用缺少可用的阅读位置。'); return; }
                    presentation?.update({ referenceFocus: `${turn.id}:${citation.id}`, restoreReferenceFocus: false }, false);
                    onOpenCitation({ locator: target, quote: citation.quote, ordinal: index + 1, id: citation.id });
                    return;
                  }
                  router.push({
                    pathname: '/reader/[id]',
                    params: { id: bookId, locator, quote: citation.quote },
                  });
                }}
                style={({ pressed }) => [styles.citationCard, pressed && styles.pressed]}
              >
                <Text style={styles.citationTitle}>{citationTitle(citation, index, bookTitle, format)}</Text>
                <SymbolView name="arrow.up.right" size={18} tintColor={palette.ink2}
                  accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
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
              void Clipboard.setStringAsync(turn.text).catch((cause: unknown) =>
                Alert.alert('复制失败', String(cause)),
              );
            }}
            style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
          >
            <SymbolView name="doc.on.doc" size={Platform.OS === 'ios' ? 44 : 15} pointSize={15} weight="regular" scale="unspecified"
              contentLayout="systemButton" tintColor={palette.ink2}
              accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          </Pressable>
        </View>
      ) : null}

      {turn.contextSummary ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => Alert.alert('上下文已整理', turn.contextSummary)}
        >
          <Text style={styles.answerHint}>较早对话已整理为摘要 · 查看</Text>
        </Pressable>
      ) : null}
      {turn.saveError ? (
        <Pressable accessibilityRole="button" onPress={() => onRetry(turn)} style={styles.statusCard}>
          <Text style={styles.statusTitle}>对话未保存</Text>
          <Text style={styles.statusBody}>{turn.saveError} · 点此重试保存</Text>
        </Pressable>
      ) : null}

      {!turn.saveError && (turn.status === 'error' || turn.status === 'cancelled' || turn.status === 'interrupted') ? (
        <View style={styles.recovery}>
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>回答未完成</Text>
            <Text style={styles.statusBody}>
              {turn.status === 'interrupted'
                ? turn.error ?? '上次生成已中断，请主动重试。'
                : turn.status === 'cancelled'
                ? '已中断，回答可能不完整。问题与选文已保留，请重试。'
                : (turn.error ?? '暂时没能连接 AI 服务，问题与选文已保留，请重试。')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重试回答"
            testID={`question-retry-${turn.id}`}
            onPress={() => {
              tapFeedback();
              onRetry(turn);
            }}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <SymbolView name="arrow.clockwise" size={16} tintColor={palette.lampInk}
              accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={styles.retryText}>重试回答</Text>
          </Pressable>
        </View>
      ) : null}

      {turn.status === 'streaming' && !turn.text && (turn.reasoning || turn.tools.length > 0) ? (
        <View style={styles.statusCardGenerating}>
          <Text style={styles.statusBodyGenerating}>正在生成</Text>
        </View>
      ) : null}

      {turn.status !== 'streaming' && Boolean(materials?.values.length) && presentation ? (
        <MenuView
          actions={[{ id: 'materials', title: '查看本次实际发送材料', image: 'doc.text' }]}
          onPressAction={({ nativeEvent: { event } }) => {
            if (event === 'materials') router.push({ pathname: '/book-chat/materials', params: {
              conversationId: presentation.conversationId, turnId: turn.id, ...presentation.appearanceParams(),
            } });
          }}
        >
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel="更多选项"
          testID={`question-more-${turn.id}`}
          style={styles.moreRow}
        >
          <SymbolView name="ellipsis" size={13} tintColor={palette.ink2}
            accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <Text style={styles.moreText}>更多</Text>
        </View>
        </MenuView>
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
    identityText: { fontSize: 10.5, fontWeight: '500', color: palette.ink2 },
    processBox: { gap: 6 },
    processHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    // Native explicit-point glyphs keep their imageView geometry as titles scale.
    thinkingChevronRight: { width: 12, height: 16.5 },
    thinkingChevronDown: { width: 17.5, height: 11 },
    thinkingTitle: { fontSize: 13, fontWeight: '500', color: palette.ink3 },
    processTitle: { fontSize: 12, color: palette.ink2 },
    processContent: { gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: palette.paperDeep },
    reasoningText: { fontSize: 13, lineHeight: 19.5, color: palette.ink3 },
    toolList: { gap: 8 },
    warningBanner: { paddingVertical: 10, paddingHorizontal: 2, borderRadius: 10, backgroundColor: palette.paperDeep },
    warningText: { fontSize: 10.5, fontWeight: '500', color: palette.ink2 },
    contextText: { fontSize: 10.5, fontWeight: '500', color: palette.ink3 },
    toolContainer: { gap: 3, paddingLeft: 16 },
    toolRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 2 },
    toolDot: { width: 6, height: 6, borderRadius: 3 },
    toolText: { flex: 1, fontSize: 12, color: palette.ink },
    toolPreview: { fontSize: 10.5, fontWeight: '500', color: palette.ink3 },
    skeleton: { gap: 8, paddingVertical: 2 },
    skeletonBar: { height: 10, borderRadius: 4, backgroundColor: palette.line },
    answerText: { fontFamily: SERIF, fontSize: 15, lineHeight: 28, color: palette.ink },
    citations: { gap: 8, marginTop: 8 },
    citationHeading: {
      fontFamily: SERIF_BOLD,
      fontSize: 15,
      lineHeight: 22,
      color: palette.ink,
      marginBottom: 1,
    },
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
    answerFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Platform.OS === 'ios' ? 0 : 2 },
    answerHint: { flex: 1, fontSize: 10, lineHeight: 16, color: palette.ink2 },
    copyButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    recovery: { gap: 8 },
    statusCard: {
      backgroundColor: palette.errorWash,
      borderRadius: 12,
      paddingVertical: 9,
      paddingHorizontal: 11,
      gap: 2,
    },
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
