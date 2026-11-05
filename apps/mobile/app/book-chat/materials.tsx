import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { AgentSentMaterial, LegacyNativeEvidence, LegacyNativeSnapshot } from '@shudeng/core';
import { loadBookConversation } from '../../src/platform/library';
import { activeConversationRun, subscribeConversationRun } from '../../src/ui/chat/conversationRuntime';
import { SERIF } from '../../src/ui/chat/format';
import { legacyMaterialLocationTitle, questionMaterials, type QuestionMaterials } from '../../src/ui/chat/materialsPresentation';
import { darkColors, lightColors, type Palette } from '../../src/ui/theme';
import { useAppearance } from '../../src/ui/appearance';
import { questionAppearanceFromParams, resolveQuestionAppearance } from '../../src/ui/reader-question/session';

const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
type MaterialRow = Readonly<{ kind: 'sent'; material: AgentSentMaterial }> | Readonly<{ kind: 'legacy-evidence'; evidence: LegacyNativeEvidence }>;

/** Current dispatched payloads and saved Native evidence are rendered as distinct display sources. */
export default function BookChatMaterialsRoute() {
  const params = useLocalSearchParams<{ conversationId?: string | string[]; turnId?: string | string[]; appearance?: string | string[]; theme?: string | string[] }>();
  const { resolvedMode } = useAppearance();
  const appearance = questionAppearanceFromParams(params);
  const palette = resolveQuestionAppearance(appearance, resolvedMode) === 'dark' ? darkColors : lightColors;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const conversationId = param(params.conversationId) ?? '';
  const turnId = param(params.turnId) ?? '';
  const [materials, setMaterials] = useState<QuestionMaterials | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let liveSeen = false;
    let live: QuestionMaterials | undefined;
    setLoading(true); setMaterials(undefined); setError(null);
    const accept = (turn: { id: string; sentMaterials?: readonly AgentSentMaterial[]; legacyNative?: LegacyNativeSnapshot }) => {
      if (turn.id !== turnId) return;
      liveSeen = true;
      live = questionMaterials(turn);
      if (mounted) setMaterials(live);
    };
    const stop = subscribeConversationRun(conversationId, ({ turn }) => accept(turn));
    const current = activeConversationRun(conversationId);
    if (current) accept(current.turn);
    void loadBookConversation(conversationId).then(messages => {
      const saved = messages.find(message => message.id === turnId);
      if (mounted) setMaterials(liveSeen ? live : saved ? questionMaterials(saved.details) : undefined);
    }).catch((cause: unknown) => {
      if (mounted && !liveSeen) setError('材料读取失败：' + (cause instanceof Error ? cause.message : String(cause)));
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; stop(); };
  }, [conversationId, turnId]);
  const rows: readonly MaterialRow[] = materials?.kind === 'legacy-evidence'
    ? materials.values.map(evidence => ({ kind: 'legacy-evidence', evidence }))
    : materials?.values.map(material => ({ kind: 'sent', material })) ?? [];

  return <View style={styles.page}>
    <Stack.Screen options={{ headerShown: true, title: '原文材料', headerBackTitle: '返回',
      headerStyle: { backgroundColor: palette.paper }, headerTintColor: palette.ink,
      headerShadowVisible: false }} />
    {loading && materials === undefined ? <ActivityIndicator style={styles.loading} color={palette.lampInk} /> :
      <FlatList testID="question-materials-list" data={rows}
        keyExtractor={(row, index) => row.kind + ':' + index + ':' + (row.kind === 'sent' ? row.material.id : row.evidence.id ?? '')} contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => item.kind === 'legacy-evidence' ? (
          <View testID={'question-legacy-material-' + (item.evidence.id ?? '')} style={styles.card}>
            <Text style={styles.legacyQuote}>{(item.evidence.id ?? '') + ' · ' + legacyMaterialLocationTitle(item.evidence) + '\n' + (item.evidence.quote ?? '')}</Text>
            <Text style={styles.legacyContext}>{item.evidence.context ?? ''}</Text>
          </View>
        ) : <View testID={'question-material-' + item.material.id} style={styles.card}>
          {item.material.kind === 'external-tool' ? <>
            <Text style={styles.title}>外部资料</Text>
            <Text style={styles.detail}>本次外部服务的返回内容没有可逐条展示的原文材料记录。</Text>
          </> : <Text selectable style={styles.material}>
            {(item.material.kind === 'selection' ? '选中原文' : item.material.id + ' · ' + item.material.name) + '\n' + item.material.content}
          </Text>}
        </View>}
        ListEmptyComponent={<Text style={styles.empty}>{error ?? (materials ? '本轮没有发送原文材料。' : '此历史回答没有保存实际发送材料记录。')}</Text>}
      />}
  </View>;
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.paper },
    loading: { flex: 1 },
    content: { paddingHorizontal: 20, paddingVertical: 22 },
    card: { borderRadius: 12, backgroundColor: palette.surface, padding: 16, gap: 8 },
    separator: { height: 16 },
    title: { fontSize: 14, lineHeight: 20, color: palette.ink2 },
    detail: { fontSize: 14, lineHeight: 22, color: palette.ink2 },
    material: { fontFamily: SERIF, fontSize: 17, lineHeight: 29, color: palette.ink },
    legacyQuote: { fontFamily: SERIF, fontSize: 17, color: palette.ink },
    legacyContext: { fontSize: 14, color: palette.ink2 },
    empty: { fontSize: 14, lineHeight: 22, color: palette.ink2, padding: 16 },
  });
}
