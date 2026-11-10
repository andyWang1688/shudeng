import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { usePalette } from "../theme";
import { SettingsRow, SettingsSection } from "./SettingsParts";

export type AIContextFormProps = {
  automatic: boolean;
  windowSize: string;
  contextWindowTokens: number;
  source: "manual" | "profile" | "fallback";
  notice: string;
  error: string;
  onAutomaticChange: (enabled: boolean) => void;
  onWindowSizeChange: (value: string) => void;
  onValidate: (value?: string) => void;
};

export function AIContextForm(props: AIContextFormProps) {
  const p = usePalette();
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <SettingsSection
        formFirst
        footer={
          props.automatic
            ? props.notice
            : "支持 1M、200K 或精确 Token 数，以服务商提供的值为准。"
        }
      >
        <SettingsRow
          title="自动设置"
          trailing={
            <Switch
              accessibilityLabel="自动设置上下文窗口"
              value={props.automatic}
              trackColor={{ false: p.line, true: p.lampInk }}
              onValueChange={props.onAutomaticChange}
            />
          }
        />
        {props.automatic ? (
          <SettingsRow
            title={props.source === "profile" ? "模型资料" : "默认值"}
            detail={
              props.contextWindowTokens.toLocaleString("en-US") + " Token"
            }
          />
        ) : (
          <View style={styles.field}>
            <Text style={[styles.label, { color: p.ink }]}>Token 数</Text>
            <TextInput
              accessibilityLabel="上下文 Token 数"
              value={props.windowSize}
              placeholder="例如 1M 或 200K"
              placeholderTextColor={p.ink3}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              clearButtonMode="while-editing"
              onChangeText={props.onWindowSizeChange}
              onEndEditing={(event) => props.onValidate(event.nativeEvent.text)}
              style={[styles.input, { color: p.ink }]}
            />
          </View>
        )}
      </SettingsSection>
      {!!props.error && (
        <Text
          style={[styles.error, { color: p.danger }]}
          accessibilityLiveRegion="polite"
        >
          {props.error}
        </Text>
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
  label: { fontSize: 17 },
  input: {
    flex: 1,
    minHeight: 32,
    fontSize: 17,
    paddingVertical: 4,
    textAlign: "right",
  },
  error: { fontSize: 13, lineHeight: 20, marginTop: 10, marginHorizontal: 16 },
});
