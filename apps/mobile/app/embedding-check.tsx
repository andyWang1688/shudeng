import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { runEmbeddingReferenceCheck, type ReferenceComparison } from '../src/platform';
import { colors, spacing } from '../src/ui/theme';

type CheckState = 'idle' | 'running' | 'done' | 'error';

/** 开发/QA 路由：native（Hermes + onnxruntime-react-native）对照 ort-1243-vectors.json。 */
export default function EmbeddingCheckRoute() {
  const params = useLocalSearchParams<{ autorun?: string | string[] }>();
  const autorunParam = Array.isArray(params.autorun) ? params.autorun[0] : params.autorun;
  const autorun = autorunParam === '1';
  const [state, setState] = useState<CheckState>('idle');
  const [output, setOutput] = useState('等待运行…');

  const run = useCallback(async (): Promise<void> => {
    setState('running');
    setOutput('加载模型/tokenizer，执行真实 embedding 对照…');
    const writeResult = (payload: unknown): void => {
      try {
        new File(Paths.document, 'embedding-check-result.json').write(JSON.stringify(payload, null, 2));
      } catch {
        // 结果文件写入失败不影响屏幕输出。
      }
    };
    try {
      const result: ReferenceComparison = await runEmbeddingReferenceCheck();
      const json = JSON.stringify(result, null, 2);
      setOutput(json);
      setState('done');
      writeResult(result);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      setOutput(message);
      setState('error');
      writeResult({ error: message });
    }
  }, []);

  useEffect(() => {
    if (!autorun) return;
    const timer = setTimeout(() => {
      void run();
    }, 600);
    return () => clearTimeout(timer);
  }, [autorun, run]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Text style={styles.title}>Embedding 对照（native）</Text>
        <Text style={styles.state}>{state}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text selectable style={styles.output}>{output}</Text>
      </ScrollView>
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
  },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  state: { fontSize: 11, color: colors.ink3 },
  scroll: { flex: 1 },
  content: { padding: spacing.sm },
  output: { fontSize: 11, lineHeight: 16, color: colors.ink, fontFamily: 'Menlo' },
});
