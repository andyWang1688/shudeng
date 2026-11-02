import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../src/ui/theme';
import { loadAIConfig, saveAIConfig } from '../src/platform/aiConfig';

/** AI 服务设置：key 存 SecureStore。 */
export default function AiSettingsRoute() {
  const router = useRouter();
  const [provider, setProvider] = useState<'deepseek' | 'openai' | 'anthropic'>('deepseek');
  const [model, setModel] = useState('deepseek-flash');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let mounted = true;
    void loadAIConfig().then((config) => {
      if (!mounted || !config) return;
      setProvider(config.provider);
      setModel(config.model);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
    });
    return () => { mounted = false; };
  }, []);

  const save = async () => {
    try {
      if (!apiKey.trim()) throw new Error('请填写 API Key');
      await saveAIConfig({ provider, model, baseUrl, apiKey: apiKey.trim() });
      setMessage('已保存。官方 key 已安全写入本机 SecureStore。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.back}>‹ 书架</Text></Pressable>
        <Text style={styles.title}>AI 服务</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Key 保存在本机 SecureStore，只用于直连你配置的模型服务。</Text>
        <Text style={styles.label}>Provider（deepseek / openai / anthropic）</Text>
        <TextInput value={provider} onChangeText={(value) => setProvider(value as typeof provider)} autoCapitalize="none" style={styles.input} />
        <Text style={styles.label}>Model</Text>
        <TextInput value={model} onChangeText={setModel} autoCapitalize="none" style={styles.input} />
        <Text style={styles.label}>Base URL</Text>
        <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" style={styles.input} />
        <Text style={styles.label}>API Key</Text>
        <TextInput value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" placeholder="粘贴官方 key" style={styles.input} />
        <Pressable accessibilityRole="button" onPress={() => void save()} style={styles.button}><Text style={styles.buttonText}>保存并测试</Text></Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  back: { fontSize: 15, color: colors.lamp },
  title: { fontSize: 15, fontWeight: '600', color: colors.ink },
  content: { padding: spacing.sm, gap: 8 },
  hint: { fontSize: 12, lineHeight: 18, color: colors.ink3, marginBottom: 4 },
  label: { fontSize: 12, color: colors.ink2, marginTop: 6 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: radius.field, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, color: colors.ink },
  button: { backgroundColor: colors.lamp, borderRadius: radius.field, paddingVertical: 11, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  message: { fontSize: 12, color: colors.ink2, marginTop: 8 },
});
