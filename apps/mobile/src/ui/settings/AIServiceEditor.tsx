import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { AI_PRESETS as PRESETS, useAIServiceDraft } from "./AIServiceDraft";
import {
  loadAIServiceForTest,
  removeAIService,
  saveAIService,
  selectAIService,
  type AIConfig,
  type AIService,
  type AIServiceDraft,
} from "../../platform/aiConfig";
import {
  aiConsentScope,
  validateServiceDraft,
} from "../../platform/settings/aiCatalog";
import { testAIConnection } from "../../platform/aiTest";
import { useAISendingConsent } from "./useAISendingConsent";
import { usePalette } from "../theme";
import {
  SettingsAction,
  SettingsHeader,
  SettingsRow,
  SettingsSection,
  showSettingsChoices,
} from "./SettingsParts";
export function AIServiceEditor({
  service,
  selected,
  onClose,
  onChanged,
}: {
  readonly service: AIService | null;
  readonly selected: boolean;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const p = usePalette();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(p), [p]);
  const { confirmAISending, sendingConsent } = useAISendingConsent();
  const {
    provider,
    setProvider,
    name,
    setName,
    model,
    setModel,
    baseUrl,
    setBaseUrl,
    windowSize,
    key,
    setKey,
  } = useAIServiceDraft();
  const [status, setStatus] = useState("尚未检查连接。");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const draft = (): AIServiceDraft =>
    validateServiceDraft({
      ...(service ? { id: service.id } : {}),
      name,
      provider,
      model,
      baseUrl,
      ...(windowSize.trim() ? { contextWindowTokens: Number(windowSize) } : {}),
    });
  const failed = (error: unknown) => {
    if (mounted.current) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      Alert.alert("操作未完成", message);
    }
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const value = draft();
      if (!key.trim() && !service) throw new Error("请填写 API Key。");
      const consent =
        service?.consentScope === aiConsentScope(value) ||
        (await confirmAISending(value, "同意并保存"));
      if (!consent || !mounted.current) return;
      await saveAIService(value, key, true);
      setKey("");
      onChanged();
      onClose();
    } catch (error) {
      failed(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const test = async () => {
    if (busy) return;
    setBusy(true);
    setTesting(true);
    controller.current = new AbortController();
    setStatus("正在检查连接…");
    try {
      const value = draft();
      const saved =
        !key.trim() && service ? await loadAIServiceForTest(service.id) : null;
      const config: AIConfig = {
        ...value,
        apiKey: key.trim() || saved?.apiKey || "",
      };
      if (!config.apiKey) throw new Error("请填写 API Key。");
      const result = await testAIConnection(config, {
        signal: controller.current.signal,
      });
      if (mounted.current) setStatus(result.message + "；尚未保存。");
    } catch (error) {
      failed(error);
    } finally {
      if (mounted.current) {
        setBusy(false);
        setTesting(false);
      }
      controller.current = null;
    }
  };
  const chooseProvider = () =>
    showSettingsChoices("服务", [
      {
        title: "DeepSeek",
        onPress: () => {
          setProvider("deepseek");
          setName(PRESETS.deepseek.name);
          setBaseUrl(PRESETS.deepseek.baseUrl);
          setModel(PRESETS.deepseek.model);
        },
      },
      {
        title: "自定义服务",
        onPress: () => {
          if (provider === "deepseek") {
            setProvider("openai");
            setName(PRESETS.openai.name);
            setBaseUrl("");
            setModel("");
          }
        },
      },
    ]);
  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SettingsHeader
          title={service ? "编辑服务" : "添加服务"}
          onBack={onClose}
          backTitle="取消"
          modal
          actions={
            <SettingsAction
              title="保存"
              primary
              disabled={busy}
              onPress={() => void save()}
            />
          }
        />
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <SettingsSection
            formFirst
            footer={
              service
                ? "已保存 API Key；留空保留，填写新 Key 可替换。"
                : "API Key 仅保存在设备 Keychain。"
            }
          >
            <SettingsRow title="服务" detail={name} onPress={chooseProvider} />
            <View style={styles.field}>
              <Text style={styles.label}>API Key</Text>
              <TextInput
                accessibilityLabel="API Key"
                value={key}
                onChangeText={setKey}
                placeholder={service ? "留空保留已保存的密钥" : "填写 API Key"}
                placeholderTextColor={p.ink3}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                style={styles.input}
              />
            </View>
            <SettingsRow title="模型" detail={model || "请在高级设置中填写"} />
          </SettingsSection>
          <SettingsSection>
            <SettingsRow
              title="高级设置"
              onPress={
                busy
                  ? undefined
                  : () =>
                      router.push({
                        pathname: "/settings/ai-service/advanced",
                        params: { serviceId: service?.id ?? "new" },
                      })
              }
            />
          </SettingsSection>
          <SettingsSection footer="检查仅发送固定短文字，可能产生费用；不会保存配置。">
            <SettingsRow
              title={testing ? "正在检查连接…" : "检查连接"}
              onPress={busy ? undefined : () => void test()}
              trailing={
                testing ? <ActivityIndicator color={p.lampInk} /> : undefined
              }
            />
            {testing ? (
              <SettingsRow
                title="取消检查"
                onPress={() => controller.current?.abort()}
              />
            ) : null}
            <SettingsRow title={status} />
          </SettingsSection>
          {service ? (
            <SettingsSection title="管理">
              <SettingsRow
                title={selected ? "当前使用的服务" : "使用这个服务"}
                selected={selected}
                onPress={
                  selected || busy
                    ? undefined
                    : () => {
                        void (async () => {
                          try {
                            if (
                              service.consentScope !==
                                aiConsentScope(service) &&
                              !(await confirmAISending(
                                service,
                                "同意并使用已保存服务",
                              ))
                            )
                              return;
                            if (!mounted.current) return;
                            await selectAIService(service.id, true);
                            if (!mounted.current) return;
                            onChanged();
                            onClose();
                          } catch (error) {
                            failed(error);
                          }
                        })();
                      }
                }
              />
              <SettingsRow
                title="删除这个服务"
                danger
                onPress={() =>
                  Alert.alert("删除此服务？", "不改写或删除对话历史。", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "删除",
                      style: "destructive",
                      onPress: () => {
                        void removeAIService(service.id)
                          .then(() => {
                            onChanged();
                            onClose();
                          })
                          .catch(failed);
                      },
                    },
                  ])
                }
              />
            </SettingsSection>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {sendingConsent}
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
    hint: { padding: 16, color: p.ink3, fontSize: 12, lineHeight: 18 },
    status: { margin: 16, color: p.ink2, fontSize: 13, lineHeight: 20 },
  });
}
