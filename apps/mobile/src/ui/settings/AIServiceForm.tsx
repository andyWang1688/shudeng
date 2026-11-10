import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { usePalette } from "../theme";
import {
  SettingsRow,
  SettingsSection,
  showSettingsChoices,
} from "./SettingsParts";
import type { AIProvider } from "../../platform/aiConfig";

export type AIServiceFields = {
  name: string;
  baseUrl: string;
  model: string;
  key: string;
};

export type AIServiceFormProps = {
  fields: AIServiceFields;
  fieldRevision: number;
  existingService: boolean;
  changingKey: boolean;
  canCancelKey: boolean;
  busy: boolean;
  testing: boolean;
  status: string;
  providerLabel: string;
  contextWindowLabel: string;
  provider: AIProvider;
  canChooseProtocol: boolean;
  supportsWebSearch: boolean;
  webSearchEnabled: boolean;
  onFieldChange: (field: keyof AIServiceFields, value: string) => void;
  onChoosePreset: () => void;
  onProviderChange: (value: AIProvider) => void;
  onChangeKey: () => void;
  onCancelKey: () => void;
  onAdvanced: () => void;
  onWebSearchChange: (enabled: boolean) => void;
  onTest: () => void;
  onCancelTest: () => void;
  onRemove: () => void;
};

export function AIServiceForm(props: AIServiceFormProps) {
  const p = usePalette();
  const field = (
    label: string,
    name: keyof AIServiceFields,
    accessibilityLabel: string,
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: p.ink2 }]}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        value={props.fields[name]}
        onChangeText={(value) => props.onFieldChange(name, value)}
        editable={!props.busy}
        keyboardType={name === "baseUrl" ? "url" : "default"}
        secureTextEntry={name === "key"}
        autoComplete="off"
        textContentType="none"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={name === "baseUrl" ? "https://" : undefined}
        placeholderTextColor={p.ink3}
        style={[styles.input, { color: p.ink }]}
      />
    </View>
  );
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <SettingsSection formFirst>
        {!props.existingService && (
          <SettingsRow
            title="使用预设"
            detail={props.providerLabel}
            disabled={props.busy}
            onPress={props.onChoosePreset}
          />
        )}
        {props.canChooseProtocol && (
          <SettingsRow
            title="接口格式"
            detail={props.provider === "anthropic" ? "Anthropic" : "OpenAI"}
            disabled={props.busy}
            onPress={() =>
              showSettingsChoices("接口格式", [
                {
                  title: "OpenAI",
                  onPress: () => props.onProviderChange("openai"),
                },
                {
                  title: "Anthropic",
                  onPress: () => props.onProviderChange("anthropic"),
                },
              ])
            }
          />
        )}
        {field("名称", "name", "服务名称")}
        {field("地址", "baseUrl", "API 根地址或完整端点")}
        {field("模型", "model", "自定义模型 ID")}
        {props.changingKey ? (
          <>
            {field(
              props.existingService ? "新密钥" : "API Key",
              "key",
              "API Key",
            )}
            {props.canCancelKey && (
              <SettingsRow
                title="取消更换密钥"
                disabled={props.busy}
                onPress={props.onCancelKey}
              />
            )}
          </>
        ) : (
          <SettingsRow
            title="API Key"
            detail="已保存 · 更换"
            disabled={props.busy}
            onPress={props.onChangeKey}
          />
        )}
      </SettingsSection>
      <SettingsSection
        {...(props.supportsWebSearch
          ? { footer: "搜索由服务商提供，可能额外收费。" }
          : {})}
      >
        {props.supportsWebSearch ? (
          <SettingsRow
            title="联网搜索"
            trailing={
              <Switch
                testID="ai-service-web-search"
                accessibilityLabel="允许联网搜索，保存后生效"
                value={props.webSearchEnabled}
                disabled={props.busy}
                trackColor={{ false: p.line, true: p.lampInk }}
                onValueChange={props.onWebSearchChange}
              />
            }
          />
        ) : null}
        <SettingsRow
          title="上下文窗口"
          detail={props.contextWindowLabel}
          disabled={props.busy}
          onPress={props.onAdvanced}
        />
      </SettingsSection>
      <SettingsSection footer="发送测试短文，可能产生费用。">
        <SettingsRow
          title={props.testing ? "正在检查连接…" : "检查连接"}
          disabled={props.busy}
          onPress={props.onTest}
          trailing={
            props.testing ? <ActivityIndicator color={p.lampInk} /> : undefined
          }
        />
        {props.testing && (
          <SettingsRow title="取消检查" onPress={props.onCancelTest} />
        )}
        {!!props.status && <SettingsRow title={props.status} />}
      </SettingsSection>
      {props.existingService && (
        <SettingsSection>
          <SettingsRow
            title="删除这个服务"
            danger
            disabled={props.busy}
            onPress={props.onRemove}
          />
        </SettingsSection>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  field: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  label: { fontSize: 17, width: 64 },
  input: {
    flex: 1,
    minHeight: 32,
    fontSize: 17,
    paddingVertical: 4,
    textAlign: "right",
  },
});
