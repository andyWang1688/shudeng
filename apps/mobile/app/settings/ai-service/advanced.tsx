import { useMemo } from "react";
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAIServiceDraft } from "../../../src/ui/settings/AIServiceDraft";
import {
  SettingsHeader,
  SettingsRow,
  SettingsSection,
} from "../../../src/ui/settings/SettingsParts";
import { usePalette } from "../../../src/ui/theme";

const WINDOWS = [
  { title: "自动（推荐）", value: "" },
  { title: "32K", value: "32000" },
  { title: "64K", value: "64000" },
  { title: "128K", value: "128000" },
  { title: "200K", value: "200000" },
  { title: "400K", value: "400000" },
  { title: "1M", value: "1000000" },
];
function choose(
  title: string,
  values: readonly string[],
  selected: number,
  onSelect: (index: number) => void,
) {
  const options = values.map(
    (value, index) => value + (selected === index ? " ✓" : ""),
  );
  if (Platform.OS === "ios")
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...options, "取消"],
        cancelButtonIndex: options.length,
      },
      (index) => {
        if (index < options.length) onSelect(index);
      },
    );
  else
    Alert.alert(title, undefined, [
      ...options.map((text, index) => ({
        text,
        onPress: () => onSelect(index),
      })),
      { text: "取消", style: "cancel" },
    ]);
}
export default function AIAdvancedRoute() {
  const router = useRouter();
  const p = usePalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const {
    name,
    setName,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    provider,
    setProvider,
    windowSize,
    setWindowSize,
  } = useAIServiceDraft();
  const selectedWindow = WINDOWS.findIndex((item) => item.value === windowSize);
  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SettingsHeader title="高级设置" onBack={() => router.back()} modal />
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <SettingsSection
            formFirst
            footer="支持 OpenAI Chat Completions、Anthropic Messages 文字接口。HTTPS 地址；本机测试可用 HTTP。地址中不要填写密钥。空路径使用 /v1，其余根路径追加文字端点。上下文窗口从常用值中选择；不确定选“自动”，会按服务使用合适的默认值。"
          >
            <View style={styles.field}>
              <Text style={styles.label}>服务名称</Text>
              <TextInput
                accessibilityLabel="服务名称"
                value={name}
                onChangeText={setName}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>地址</Text>
              <TextInput
                accessibilityLabel="API 根地址或完整端点"
                value={baseUrl}
                onChangeText={setBaseUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>自定义模型</Text>
              <TextInput
                accessibilityLabel="自定义模型 ID"
                value={model}
                onChangeText={setModel}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </View>
            <SettingsRow
              title="上下文窗口"
              detail={
                WINDOWS[selectedWindow]?.title.replace("（推荐）", "") ??
                windowSize
              }
              onPress={() =>
                choose(
                  "上下文窗口",
                  WINDOWS.map((item) => item.title),
                  selectedWindow,
                  (index) => {
                    const value = WINDOWS[index];
                    if (value) setWindowSize(value.value);
                  },
                )
              }
            />
            <SettingsRow
              title="接口格式"
              detail={provider === "anthropic" ? "Anthropic" : "OpenAI"}
              onPress={() =>
                choose(
                  "接口格式",
                  ["OpenAI Chat Completions", "Anthropic Messages"],
                  provider === "anthropic" ? 1 : 0,
                  (index) =>
                    setProvider(
                      index === 1
                        ? "anthropic"
                        : provider === "deepseek"
                          ? "deepseek"
                          : "openai",
                    ),
                )
              }
            />
          </SettingsSection>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function makeStyles(p: ReturnType<typeof usePalette>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.paper },
    content: { paddingHorizontal: 16, paddingBottom: 32 },
    field: {
      minHeight: 79,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 6,
    },
    label: { color: p.ink2, fontSize: 13, fontWeight: "500" },
    input: {
      minHeight: 32,
      fontSize: 17,
      color: p.ink,
      backgroundColor: p.paperDeep,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
  });
}
