import {
  Form,
  LabeledContent,
  Section,
  Text,
  TextField,
  Toggle,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  autocorrectionDisabled,
  foregroundStyle,
  keyboardType,
  lineLimit,
  multilineTextAlignment,
  scrollDismissesKeyboard,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import type { AIContextFormProps } from "./AIContextForm";

function ManualContextField(props: AIContextFormProps) {
  const text = useNativeState(props.windowSize);
  return (
    <LabeledContent label="Token 数">
      <TextField
        text={text}
        placeholder="例如 1M 或 200K"
        onTextChange={props.onWindowSizeChange}
        onFocusChange={(focused) => {
          if (!focused) props.onValidate(text.get());
        }}
        modifiers={[
          accessibilityLabel("上下文 Token 数"),
          autocorrectionDisabled(),
          textInputAutocapitalization("never"),
          multilineTextAlignment("trailing"),
          keyboardType("ascii-capable"),
          lineLimit(1),
        ]}
      />
    </LabeledContent>
  );
}

export function AIContextForm(props: AIContextFormProps) {
  return (
    <Form modifiers={[scrollDismissesKeyboard("interactively")]}>
      <Section
        footer={
          <Text>
            {props.automatic
              ? props.notice
              : "支持 1M、200K 或精确 Token 数，以服务商提供的值为准。"}
          </Text>
        }
      >
        <Toggle
          label="自动设置"
          isOn={props.automatic}
          onIsOnChange={props.onAutomaticChange}
          modifiers={[accessibilityLabel("自动设置上下文窗口")]}
        />
        {props.automatic ? (
          <LabeledContent
            label={props.source === "profile" ? "模型资料" : "默认值"}
          >
            <Text modifiers={[foregroundStyle("secondary")]}>
              {props.contextWindowTokens.toLocaleString("en-US") + " Token"}
            </Text>
          </LabeledContent>
        ) : (
          <ManualContextField {...props} />
        )}
      </Section>
      {!!props.error && (
        <Section>
          <Text modifiers={[foregroundStyle("red")]}>{props.error}</Text>
        </Section>
      )}
    </Form>
  );
}
