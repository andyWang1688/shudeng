import { useEffect, useRef } from "react";
import {
  Button,
  Form,
  HStack,
  Image,
  LabeledContent,
  ProgressView,
  Picker,
  Section,
  SecureField,
  Text,
  TextField,
  Toggle,
  VStack,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  autocorrectionDisabled,
  disabled,
  foregroundStyle,
  fixedSize,
  font,
  frame,
  keyboardType,
  lineLimit,
  multilineTextAlignment,
  scrollDismissesKeyboard,
  textInputAutocapitalization,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import type { AIServiceFields, AIServiceFormProps } from "./AIServiceForm";

function ServiceField({
  label,
  name,
  props,
}: {
  label: string;
  name: keyof AIServiceFields;
  props: AIServiceFormProps;
}) {
  const value = props.fields[name];
  const text = useNativeState(value);
  const synchronizedRevision = useRef(props.fieldRevision);
  useEffect(() => {
    if (props.fieldRevision === synchronizedRevision.current) return;
    synchronizedRevision.current = props.fieldRevision;
    text.set(value);
  }, [text, value, props.fieldRevision]);
  const inputProps = {
    text,
    onTextChange: (value: string) => {
      props.onFieldChange(name, value);
    },
    modifiers: [
      disabled(props.busy),
      autocorrectionDisabled(),
      textInputAutocapitalization("never"),
      multilineTextAlignment(name === "baseUrl" ? "leading" : "trailing"),
      accessibilityLabel(
        name === "name"
          ? "服务名称"
          : name === "baseUrl"
            ? "API 根地址或完整端点"
            : name === "model"
              ? "自定义模型 ID"
              : "API Key",
      ),
    ],
  };
  if (name === "baseUrl") {
    return (
      <VStack alignment="leading" spacing={6}>
        <Text
          modifiers={[
            font({ textStyle: "caption" }),
            foregroundStyle(props.busy ? "secondary" : "primary"),
          ]}
        >
          {label}
        </Text>
        <TextField
          {...inputProps}
          axis="vertical"
          modifiers={[
            ...inputProps.modifiers,
            keyboardType("url"),
            lineLimit({ min: 1, max: 3 }),
            fixedSize({ horizontal: false, vertical: true }),
          ]}
        />
      </VStack>
    );
  }
  return (
    <LabeledContent label={label}>
      {name === "key" ? (
        <SecureField {...inputProps} placeholder="填写新密钥" />
      ) : (
        <TextField
          {...inputProps}
          modifiers={[...inputProps.modifiers, lineLimit(1)]}
        />
      )}
    </LabeledContent>
  );
}

export function AIServiceForm(props: AIServiceFormProps) {
  const action = [disabled(props.busy)];
  const disclosure = (title: string, onPress: () => void, detail?: string) => (
    <Button onPress={onPress} modifiers={action}>
      <HStack spacing={12}>
        <Text modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}>
          {title}
        </Text>
        {!!detail && (
          <Text modifiers={[foregroundStyle("secondary")]}>{detail}</Text>
        )}
        <Image
          systemName="chevron.right"
          size={12}
          modifiers={[foregroundStyle("tertiary")]}
        />
      </HStack>
    </Button>
  );
  return (
    <Form modifiers={[scrollDismissesKeyboard("interactively")]}>
      <Section>
        {!props.existingService &&
          disclosure("使用预设", props.onChoosePreset, props.providerLabel)}
        {props.canChooseProtocol && (
          <Picker
            label="接口格式"
            selection={props.provider}
            onSelectionChange={props.onProviderChange}
            modifiers={[pickerStyle("menu"), disabled(props.busy)]}
          >
            <Text modifiers={[tag("openai")]}>OpenAI</Text>
            <Text modifiers={[tag("anthropic")]}>Anthropic</Text>
          </Picker>
        )}
        <ServiceField label="名称" name="name" props={props} />
        <ServiceField label="地址" name="baseUrl" props={props} />
        <ServiceField label="模型" name="model" props={props} />
        {props.changingKey ? (
          <>
            <ServiceField
              label={props.existingService ? "新密钥" : "API Key"}
              name="key"
              props={props}
            />
            {props.canCancelKey && (
              <Button
                label="取消更换密钥"
                onPress={props.onCancelKey}
                modifiers={[disabled(props.busy)]}
              />
            )}
          </>
        ) : (
          <LabeledContent label="API Key">
            <Button
              label="已保存 · 更换"
              onPress={props.onChangeKey}
              modifiers={[disabled(props.busy)]}
            />
          </LabeledContent>
        )}
      </Section>
      <Section
        footer={
          props.supportsWebSearch ? (
            <Text>搜索由服务商提供，可能额外收费。</Text>
          ) : undefined
        }
      >
        {props.supportsWebSearch ? (
          <Toggle
            label="联网搜索"
            isOn={props.webSearchEnabled}
            onIsOnChange={props.onWebSearchChange}
            modifiers={[disabled(props.busy)]}
          />
        ) : null}
        {disclosure("上下文窗口", props.onAdvanced, props.contextWindowLabel)}
      </Section>
      <Section footer={<Text>发送测试短文，可能产生费用。</Text>}>
        {props.testing ? (
          <HStack>
            <Text>正在检查连接…</Text>
            <ProgressView />
          </HStack>
        ) : (
          <Button
            label="检查连接"
            onPress={props.onTest}
            modifiers={[disabled(props.busy)]}
          />
        )}
        {props.testing && (
          <Button label="取消检查" onPress={props.onCancelTest} />
        )}
        {!!props.status && (
          <Text modifiers={[foregroundStyle("secondary")]}>{props.status}</Text>
        )}
      </Section>
      {props.existingService && (
        <Section>
          <Button
            label="删除这个服务"
            role="destructive"
            onPress={props.onRemove}
            modifiers={[disabled(props.busy)]}
          />
        </Section>
      )}
    </Form>
  );
}
