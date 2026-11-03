import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, spacing, usePalette, type Palette } from '../src/ui/theme';
import { loadAIConfig, saveAIConfig, type AIConfig } from '../src/platform/aiConfig';
import { testAIConnection } from '../src/platform/aiTest';

type Provider = AIConfig['provider'];

const PRESETS: Record<Provider, { label: string; model: string; baseUrl: string }> = {
  deepseek: { label: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
  openai: { label: 'OpenAI', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic', model: 'claude-sonnet-4-5', baseUrl: 'https://api.anthropic.com' },
};

function buildConfig(provider: Provider, model: string, baseUrl: string, apiKey: string): AIConfig {
  if (!apiKey.trim()) throw new Error('请填写 API Key');
  if (!model.trim()) throw new Error('请填写模型名称');
  if (!baseUrl.trim()) throw new Error('请填写 Base URL');
  return { provider, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() };
}

export default function AiSettingsRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const mountedRef = useRef(true);
  const testAbortRef = useRef<AbortController | null>(null);
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [model, setModel] = useState(PRESETS.deepseek.model);
  const [baseUrl, setBaseUrl] = useState(PRESETS.deepseek.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadAIConfig().then((config) => {
      if (!mounted) return;
      if (config) {
        setProvider(config.provider);
        setModel(config.model);
        setBaseUrl(config.baseUrl);
        setApiKey(config.apiKey);
      }
      setLoaded(true);
    });
    return () => {
      mounted = false;
      mountedRef.current = false;
      testAbortRef.current?.abort();
    };
  }, []);

  const selectProvider = (next: Provider) => {
    const previousPreset = PRESETS[provider];
    setProvider(next);
    setMessage('');
    if (model.trim() === previousPreset.model || model.trim().length === 0) setModel(PRESETS[next].model);
    if (baseUrl.trim() === previousPreset.baseUrl || baseUrl.trim().length === 0) setBaseUrl(PRESETS[next].baseUrl);
  };

  const save = async (): Promise<void> => {
    let config: AIConfig;
    try {
      config = buildConfig(provider, model, baseUrl, apiKey);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setMessage(text);
      Alert.alert('AI 服务', text);
      return;
    }
    const controller = new AbortController();
    testAbortRef.current?.abort();
    testAbortRef.current = controller;
    setTesting(true);
    setMessage('正在测试连接…');
    try {
      if (!mountedRef.current) return;
      if (controller.signal.aborted) {
        setMessage('已取消连接测试。');
        return;
      }
      const result = await testAIConnection(config, { signal: controller.signal });
      if (!mountedRef.current) return;
      if (controller.signal.aborted) {
        setMessage('已取消连接测试。');
        return;
      }
      if (!result.ok) {
        setMessage(`连接失败，未保存：${result.message}`);
        Alert.alert('AI 服务连接失败', `连接失败，未保存。${result.message}`);
        return;
      }
      await saveAIConfig(config);
      if (!mountedRef.current) return;
      setMessage(`连接成功，已保存。${result.message}`);
    } catch (cause) {
      if (mountedRef.current && !controller.signal.aborted) {
        setMessage(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (testAbortRef.current === controller) testAbortRef.current = null;
      if (mountedRef.current) setTesting(false);
    }
  };

  const saveOnly = async (): Promise<void> => {
    let config: AIConfig;
    try {
      config = buildConfig(provider, model, baseUrl, apiKey);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setMessage(text);
      Alert.alert('AI 服务', text);
      return;
    }
    try {
      await saveAIConfig(config);
      if (mountedRef.current) setMessage('已保存。连接测试可稍后再试。');
    } catch (cause) {
      if (mountedRef.current) setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回我的" onPress={() => router.back()}><Text style={styles.back}>‹ 我的</Text></Pressable>
        <Text style={styles.title}>AI 服务</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>书内问答直连你选择的服务商。API Key 仅保存在本机 SecureStore。</Text>
        <Text style={styles.label}>服务商</Text>
        <View style={styles.providers}>
          {(Object.keys(PRESETS) as Provider[]).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`选择${PRESETS[key].label}`}
              onPress={() => selectProvider(key)}
              style={[styles.providerChip, provider === key && styles.providerChipActive]}
            >
              <Text style={[styles.providerText, provider === key && styles.providerTextActive]}>{PRESETS[key].label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>模型</Text>
        <TextInput value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        <Text style={styles.label}>Base URL</Text>
        <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} />
        <Text style={styles.label}>API Key</Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="粘贴官方 API Key"
          placeholderTextColor={palette.ink3}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={testing ? '正在测试连接' : '保存并测试连接'}
          disabled={testing || !loaded}
          onPress={() => void save()}
          style={[styles.button, (testing || !loaded) && styles.disabled]}
        >
          {testing ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={palette.ink} />
              <Text style={styles.buttonText}>正在测试连接…</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>保存并测试连接</Text>
          )}
        </Pressable>
        {testing ? (
          <Pressable accessibilityRole="button" onPress={() => testAbortRef.current?.abort()} style={styles.cancelTest}>
            <Text style={styles.cancelTestText}>取消测试</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="只保存，不测试"
          disabled={testing || !loaded}
          onPress={() => void saveOnly()}
          style={[styles.secondaryButton, (testing || !loaded) && styles.disabled]}
        >
          <Text style={styles.secondaryText}>只保存，不测试</Text>
        </Pressable>
        {message ? (
          <Text style={[styles.message, (message.startsWith('连接成功') || message.startsWith('已保存。')) && styles.messageOk]}>
            {message}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
    back: { fontSize: 15, color: palette.lamp },
    title: { fontSize: 17, fontWeight: '600', color: palette.ink },
    content: { padding: spacing.md, gap: 6 },
    hint: { fontSize: 12, lineHeight: 18, color: palette.ink3, marginBottom: 4 },
    label: { fontSize: 12, color: palette.ink2, marginTop: 8 },
    providers: { flexDirection: 'row', gap: spacing.xs },
    providerChip: { flex: 1, alignItems: 'center', borderRadius: radius.field, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, backgroundColor: palette.surface, paddingVertical: 9 },
    providerChipActive: { backgroundColor: palette.lampWash, borderColor: palette.lamp },
    providerText: { fontSize: 13, color: palette.ink2 },
    providerTextActive: { color: palette.ink, fontWeight: '600' },
    input: { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, borderRadius: radius.field, backgroundColor: palette.surface, paddingHorizontal: 10, paddingVertical: 10, fontSize: 13, color: palette.ink },
    button: { marginTop: spacing.md, backgroundColor: palette.lamp, borderRadius: radius.field, paddingVertical: 12, alignItems: 'center' },
    buttonText: { fontSize: 14, fontWeight: '600', color: palette.ink },
    busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    disabled: { opacity: 0.6 },
    cancelTest: { alignSelf: 'center', paddingVertical: 8, marginTop: 2 },
    cancelTestText: { fontSize: 12, color: palette.ink2 },
    secondaryButton: { marginTop: 2, borderRadius: radius.field, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, backgroundColor: palette.surface, paddingVertical: 11, alignItems: 'center' },
    secondaryText: { fontSize: 13, color: palette.ink2 },
    message: { fontSize: 12, lineHeight: 18, color: palette.error, marginTop: 8 },
    messageOk: { color: palette.lampInk },
  });
}
