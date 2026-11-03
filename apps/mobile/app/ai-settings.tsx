import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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

export default function AiSettingsRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
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
    };
  }, []);

  const selectProvider = (next: Provider) => {
    const previousPreset = PRESETS[provider];
    setProvider(next);
    setMessage('');
    if (model.trim() === previousPreset.model || model.trim().length === 0) setModel(PRESETS[next].model);
    if (baseUrl.trim() === previousPreset.baseUrl || baseUrl.trim().length === 0) setBaseUrl(PRESETS[next].baseUrl);
  };

  const save = async () => {
    try {
      if (!apiKey.trim()) throw new Error('请填写 API Key');
      if (!model.trim()) throw new Error('请填写模型名称');
      if (!baseUrl.trim()) throw new Error('请填写 Base URL');
      setTesting(true);
      setMessage('正在保存并测试连接…');
      const config = { provider, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() } as const;
      await saveAIConfig(config);
      const result = await testAIConnection(config);
      setMessage(result.ok ? `连接成功。${result.message}` : `已保存，但连接失败：${result.message}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTesting(false);
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
        <Pressable accessibilityRole="button" disabled={testing || !loaded} onPress={() => void save()} style={[styles.button, (testing || !loaded) && styles.disabled]}>
          {testing ? <ActivityIndicator size="small" color={palette.ink} /> : <Text style={styles.buttonText}>保存并测试连接</Text>}
        </Pressable>
        {message ? <Text style={[styles.message, message.startsWith('连接成功') && styles.messageOk]}>{message}</Text> : null}
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
    disabled: { opacity: 0.6 },
    message: { fontSize: 12, lineHeight: 18, color: palette.error, marginTop: 8 },
    messageOk: { color: palette.lampInk },
  });
}
