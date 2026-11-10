import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform } from "react-native";
import { usePreventRemove, useRouter } from "expo-router";
import {
  parseContextWindowTokens,
  resolveWebSearchPolicy,
} from "@shudeng/core/agent";
import { AI_PRESETS as PRESETS, useAIServiceDraft } from "./AIServiceDraft";
import {
  loadAIServiceForTest,
  removeAIService,
  saveAIService,
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
import { SettingsEditorLayout } from "./SettingsEditorLayout";
import { AIServiceForm, type AIServiceFormProps } from "./AIServiceForm";
import {
  SettingsAction,
  SettingsHeader,
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
    windowAutomatic,
    key,
    setKey,
    webSearchEnabled,
    setWebSearchEnabled,
  } = useAIServiceDraft();
  const serviceProvider = service?.provider ?? provider;
  const supportsWebSearch =
    resolveWebSearchPolicy(serviceProvider, baseUrl, { enabled: true }).state
      .status === "enabled";
  const [status, setStatus] = useState("");
  const [changingKey, setChangingKey] = useState(!service || !!key);
  const [requiresNewKey, setRequiresNewKey] = useState(!service);
  const [fieldRevision, setFieldRevision] = useState(0);
  const [customProvider, setCustomProvider] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [closingEditor, setClosingEditor] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const closing = useRef(false);
  const closeNotice = useRef(false);
  const currentFields = JSON.stringify({
    provider,
    name,
    model,
    baseUrl,
    windowSize,
    windowAutomatic,
    key,
    webSearchEnabled,
  });
  const initialFields = useRef(currentFields);
  const dirty = currentFields !== initialFields.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const active = () => mounted.current && !closing.current;
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setClosingEditor(true);
    disablePrevention();
    controller.current?.abort();
    onClose();
  };
  const requestClose = (discard = close) => {
    if (!active() || closeNotice.current) return;
    if (!dirty || inFlight.current) {
      discard();
      return;
    }
    closeNotice.current = true;
    Alert.alert("保存修改？", undefined, [
      {
        text: "继续编辑",
        style: "cancel",
        onPress: () => {
          closeNotice.current = false;
        },
      },
      {
        text: "放弃修改",
        style: "destructive",
        onPress: () => {
          closeNotice.current = false;
          discard();
        },
      },
      {
        text: "保存",
        onPress: () => {
          closeNotice.current = false;
          void save();
        },
      },
    ]);
  };
  const disablePrevention = usePreventRemove(
    dirty && !closingEditor,
    ({ repeat }) => {
      if (closing.current) {
        repeat();
        return;
      }
      requestClose(() => {
        closing.current = true;
        setClosingEditor(true);
        controller.current?.abort();
        repeat();
      });
    },
  );
  const editable = () => active() && !inFlight.current;
  const begin = () => {
    if (!editable()) return false;
    inFlight.current = true;
    setBusy(true);
    return true;
  };
  const finish = () => {
    inFlight.current = false;
    if (active()) setBusy(false);
  };
  const draft = (): AIServiceDraft => {
    const tokens = parseContextWindowTokens(windowAutomatic ? "" : windowSize);
    if (windowAutomatic === false && tokens === undefined)
      throw new Error("请输入上下文 Token 数，或切回自动。");
    return validateServiceDraft({
      ...(service ? { id: service.id } : {}),
      name,
      provider: serviceProvider,
      model,
      baseUrl,
      webSearchEnabled: supportsWebSearch && webSearchEnabled,
      ...(tokens !== undefined ? { contextWindowTokens: tokens } : {}),
    });
  };
  const failed = (error: unknown) => {
    if (active()) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      Alert.alert("操作未完成", message);
    }
  };
  const save = async () => {
    if (!begin()) return;
    try {
      const value = draft();
      if (!key.trim() && requiresNewKey) throw new Error("请填写 API Key。");
      const consent =
        service?.consentScope === aiConsentScope(value) ||
        (await confirmAISending(value, "同意并保存"));
      if (!consent || !active()) return;
      await saveAIService(value, key, true);
      if (!active()) return;
      setKey("");
      onChanged();
      close();
    } catch (error) {
      failed(error);
    } finally {
      finish();
    }
  };
  const test = async () => {
    if (!begin()) return;
    setTesting(true);
    const request = new AbortController();
    controller.current = request;
    setStatus("正在检查连接…");
    try {
      const value = draft();
      if (!key.trim() && requiresNewKey) throw new Error("请填写 API Key。");
      const saved =
        !key.trim() && service ? await loadAIServiceForTest(service.id) : null;
      if (!active() || request.signal.aborted) return;
      const config: AIConfig = {
        ...value,
        apiKey: key.trim() || saved?.apiKey || "",
      };
      if (!config.apiKey) throw new Error("请填写 API Key。");
      const result = await testAIConnection(config, {
        signal: request.signal,
      });
      if (active() && !request.signal.aborted)
        setStatus(result.message + "；尚未保存。");
    } catch (error) {
      if (!request.signal.aborted) failed(error);
    } finally {
      if (active()) {
        if (request.signal.aborted) setStatus("检查已取消。");
        setTesting(false);
      }
      finish();
      controller.current = null;
    }
  };
  const applyPreset = (value: AIService["provider"]) => {
    if (!editable() || service) return;
    const preset = PRESETS[value];
    setProvider(value);
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setKey("");
    setChangingKey(true);
    setRequiresNewKey(true);
    setFieldRevision((revision) => revision + 1);
    setWebSearchEnabled(false);
    setCustomProvider(false);
    setStatus("");
  };
  const chooseProvider = () => {
    if (!editable() || service) return;
    showSettingsChoices("使用预设", [
      ...(["deepseek", "openai", "anthropic"] as const).map((value) => ({
        title: PRESETS[value].name,
        onPress: () => {
          if (!editable() || service) return;
          if (!service && currentFields === initialFields.current) {
            applyPreset(value);
            return;
          }
          Alert.alert(
            "替换为 " + PRESETS[value].name + " 预设？",
            "名称、地址和模型将被替换，需要重新填写密钥。",
            [
              { text: "取消", style: "cancel" },
              { text: "使用预设", onPress: () => applyPreset(value) },
            ],
          );
        },
      })),
      {
        title: "自定义",
        onPress: () => {
          if (!editable() || service) return;
          setProvider("openai");
          setCustomProvider(true);
          setStatus("");
        },
      },
    ]);
  };
  const remove = async () => {
    if (!service || !begin()) return;
    try {
      await removeAIService(service.id);
      if (!active()) return;
      onChanged();
      close();
    } catch (error) {
      failed(error);
    } finally {
      finish();
    }
  };
  const confirmRemove = () => {
    if (!editable()) return;
    Alert.alert(
      "删除此服务？",
      selected
        ? "删除后需要重新选择服务。对话记录会保留。"
        : "对话记录会保留。",
      [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => void remove() },
      ],
    );
  };
  const formProps: AIServiceFormProps = {
    fields: { name, baseUrl, model, key },
    fieldRevision,
    existingService: !!service,
    changingKey,
    canCancelKey: !!service && !requiresNewKey,
    busy,
    testing,
    status,
    provider: serviceProvider,
    canChooseProtocol: !service && customProvider,
    providerLabel: customProvider
      ? "自定义"
      : presetLabel(serviceProvider, baseUrl),
    contextWindowLabel: windowAutomatic ? "自动" : windowSize.trim() || "手动",
    supportsWebSearch,
    webSearchEnabled: supportsWebSearch && webSearchEnabled,
    onFieldChange: (field, value) => {
      if (!editable()) return;
      ({ name: setName, baseUrl: setBaseUrl, model: setModel, key: setKey })[
        field
      ](value);
      setStatus("");
    },
    onChoosePreset: chooseProvider,
    onProviderChange: (value) => {
      if (!editable() || service || !customProvider) return;
      setProvider(value);
      setWebSearchEnabled(false);
      setStatus("");
    },
    onChangeKey: () => {
      if (editable()) setChangingKey(true);
    },
    onCancelKey: () => {
      if (!editable() || requiresNewKey) return;
      setKey("");
      setChangingKey(false);
      setStatus("");
    },
    onAdvanced: () => {
      if (editable())
        router.push({
          pathname: "/settings/ai-service/advanced",
          params: { serviceId: service?.id ?? "new" },
        });
    },
    onWebSearchChange: (value) => {
      if (editable() && supportsWebSearch) setWebSearchEnabled(value);
    },
    onTest: () => void test(),
    onCancelTest: () => controller.current?.abort(),
    onRemove: confirmRemove,
  };
  return (
    <>
      <SettingsEditorLayout
        title={service ? "编辑 AI 服务" : "添加 AI 服务"}
        onLeadingAction={() => requestClose()}
        onSave={() => void save()}
        saveDisabled={busy}
        nativeContent={
          Platform.OS === "ios" ? <AIServiceForm {...formProps} /> : undefined
        }
        fallbackHeader={
          <SettingsHeader
            title={service ? "编辑 AI 服务" : "添加 AI 服务"}
            onBack={() => requestClose()}
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
        }
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: p.paper }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <AIServiceForm {...formProps} />
        </KeyboardAvoidingView>
      </SettingsEditorLayout>
      {sendingConsent}
    </>
  );
}

function presetLabel(provider: AIService["provider"], address: string): string {
  try {
    const host = new URL(address).hostname.toLowerCase();
    if (provider === "deepseek" && host === "api.deepseek.com")
      return "DeepSeek";
    if (provider === "anthropic" && host === "api.anthropic.com")
      return "Anthropic";
    if (provider === "openai" && host === "api.openai.com") return "OpenAI";
  } catch {
    /* Invalid drafts remain editable; saving validates the address. */
  }
  return "自定义";
}
