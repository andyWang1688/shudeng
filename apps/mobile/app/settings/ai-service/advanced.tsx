import { useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import {
  inspectModelContext,
  parseContextWindowTokens,
} from "@shudeng/core/agent";
import { useAIServiceDraft } from "../../../src/ui/settings/AIServiceDraft";
import {
  AIContextForm,
  type AIContextFormProps,
} from "../../../src/ui/settings/AIContextForm";
import { SettingsEditorLayout } from "../../../src/ui/settings/SettingsEditorLayout";
import { SettingsHeader } from "../../../src/ui/settings/SettingsParts";
import { usePalette } from "../../../src/ui/theme";

export default function AIAdvancedRoute() {
  const router = useRouter();
  const p = usePalette();
  const {
    baseUrl,
    model,
    provider,
    windowSize,
    setWindowSize,
    manualWindowSize,
    setManualWindowSize,
    windowAutomatic,
    setWindowAutomatic,
  } = useAIServiceDraft();
  const [error, setError] = useState("");
  const automaticMode = useRef(windowAutomatic);
  automaticMode.current = windowAutomatic;
  const info = useMemo(
    () => inspectModelContext({ provider, model, baseUrl }),
    [provider, model, baseUrl],
  );
  const validate = (value = windowSize) => {
    if (automaticMode.current) {
      setError("");
      return;
    }
    try {
      const tokens = parseContextWindowTokens(value);
      if (!windowAutomatic && tokens === undefined)
        throw new Error("请输入上下文 Token 数，或切回自动。");
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "请输入有效的 Token 数。",
      );
    }
  };
  const formProps: AIContextFormProps = {
    automatic: windowAutomatic,
    windowSize,
    contextWindowTokens: info.contextWindowTokens,
    source: info.source,
    notice: info.notice,
    error,
    onAutomaticChange: (enabled) => {
      automaticMode.current = enabled;
      setWindowAutomatic(enabled);
      setWindowSize(enabled ? "" : manualWindowSize);
      setError("");
    },
    onWindowSizeChange: (value) => {
      if (automaticMode.current) return;
      setWindowSize(value);
      setManualWindowSize(value);
      setError("");
    },
    onValidate: validate,
  };
  return (
    <SettingsEditorLayout
      title="上下文窗口"
      leadingIsBack
      onLeadingAction={() => router.back()}
      nativeContent={
        Platform.OS === "ios" ? <AIContextForm {...formProps} /> : undefined
      }
      fallbackHeader={
        <SettingsHeader title="上下文窗口" onBack={() => router.back()} modal />
      }
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: p.paper }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <AIContextForm {...formProps} />
      </KeyboardAvoidingView>
    </SettingsEditorLayout>
  );
}
