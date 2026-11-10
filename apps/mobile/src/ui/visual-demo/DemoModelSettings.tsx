/** Interaction prototype. Sample services and drafts live only in memory. */
import { useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { demoColors as c } from "./demoTheme";
import { DemoEditorLayout } from "./DemoEditorLayout";
import { DemoServiceList } from "./DemoServiceList";
import { parseDemoContextWindow } from "./demoContextWindow";

type Provider = "DeepSeek" | "OpenAI" | "Anthropic" | "自定义";
export type DemoService = {
  id: string;
  name: string;
  provider: Provider;
  url: string;
  model: string;
  key: string;
  search: boolean;
  window: string;
  protocol: string;
};
export const sampleServices: DemoService[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "DeepSeek",
    url: "https://api.deepseek.com",
    model: "deepseek-chat",
    key: "sample-key",
    search: false,
    window: "自动",
    protocol: "OpenAI",
  },
  {
    id: "openai",
    name: "OpenAI",
    provider: "OpenAI",
    url: "https://api.openai.com/v1",
    model: "gpt-4.1",
    key: "sample-key",
    search: false,
    window: "自动",
    protocol: "OpenAI",
  },
];
const presets = {
  DeepSeek: {
    url: "https://api.deepseek.com",
    model: "deepseek-chat",
    protocol: "OpenAI",
  },
  OpenAI: {
    url: "https://api.openai.com/v1",
    model: "gpt-4.1",
    protocol: "OpenAI",
  },
  Anthropic: {
    url: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    protocol: "Anthropic",
  },
  自定义: { url: "", model: "", protocol: "OpenAI" },
} as const;
function choices(
  title: string,
  values: string[],
  onSelect: (value: string) => void,
) {
  if (Platform.OS === "ios")
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...values, "取消"], cancelButtonIndex: values.length },
      (index) => {
        const value = values[index];
        if (value) onSelect(value);
      },
    );
  else
    Alert.alert(title, undefined, [
      ...values.map((value) => ({
        text: value,
        onPress: () => onSelect(value),
      })),
      { text: "取消", style: "cancel" },
    ]);
}

export function DemoModelSettings({
  services,
  selectedId,
  onSelect,
  onSave,
  onRemove,
  onBack,
}: {
  services: DemoService[];
  selectedId: string;
  onSelect: (id: string) => void;
  onSave: (service: DemoService) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<DemoService | null>(null);
  const [notice, setNotice] = useState("");
  const blank = (): DemoService => ({
    id: "",
    provider: "DeepSeek",
    name: "DeepSeek",
    ...presets.DeepSeek,
    key: "",
    search: false,
    window: "自动",
  });
  const remove = (service: DemoService) => {
    Alert.alert(
      "删除“" + service.name + "”？",
      service.id === selectedId
        ? "删除后需要选择另一个服务。对话记录会保留。"
        : "对话记录会保留。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            onRemove(service.id);
            setEditing(null);
            setNotice("已删除服务配置。");
          },
        },
      ],
    );
  };
  return (
    <View style={s.screen}>
      <Header title="AI 服务" onBack={onBack} />
      <DemoServiceList
        services={services}
        selectedId={selectedId}
        notice={
          notice ||
          (services.length
            ? "点选后，下一次提问使用该服务。"
            : "添加一个服务后即可开始提问。")
        }
        onSelect={(service) => {
          onSelect(service.id);
          setNotice("");
        }}
        onEdit={(service) => {
          setEditing(service);
          setNotice("");
        }}
        onAdd={() => {
          setEditing(blank());
          setNotice("");
        }}
        onRemove={remove}
      />
      {editing && (
        <ServiceEditor
          key={editing.id || "new"}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(value) => {
            onSave({ ...value, id: value.id || "sample-" + Date.now() });
            setEditing(null);
            setNotice(
              "已保存" +
                (value.id === selectedId
                  ? "，下一次提问生效。"
                  : "，点选后使用。"),
            );
          }}
          onRemove={() => remove(editing)}
        />
      )}
    </View>
  );
}

function ServiceEditor({
  initial,
  onClose,
  onSave,
  onRemove,
}: {
  initial: DemoService;
  onClose: () => void;
  onSave: (value: DemoService) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [advanced, setAdvanced] = useState(false);
  const [manualWindow, setManualWindow] = useState(
    initial.window === "自动" ? "" : initial.window,
  );
  const [windowError, setWindowError] = useState("");
  const [error, setError] = useState("");
  const leaveAdvanced = () => {
    if (
      draft.window !== "自动" &&
      parseDemoContextWindow(draft.window) === undefined
    ) {
      setWindowError("请输入正整数 Token 数，例如 1M 或 1047576。");
      return;
    }
    setWindowError("");
    setAdvanced(false);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const update = (patch: Partial<DemoService>) => {
    setDraft((old) => ({ ...old, ...patch }));
    setError("");
  };
  const save = () => {
    if (
      !draft.name.trim() ||
      !draft.url.trim() ||
      !draft.model.trim() ||
      !draft.key.trim()
    ) {
      setError("请填写名称、地址、模型和 API Key。");
      return;
    }
    const tokens =
      draft.window === "自动"
        ? undefined
        : parseDemoContextWindow(draft.window);
    if (draft.window !== "自动" && tokens === undefined) {
      setWindowError("请输入正整数 Token 数，例如 1M 或 1047576。");
      setAdvanced(true);
      return;
    }
    onSave({
      ...draft,
      window: tokens === undefined ? "自动" : String(tokens),
      name: draft.name.trim(),
      url: draft.url.trim(),
      model: draft.model.trim(),
    });
  };
  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert("保存修改？", undefined, [
      { text: "继续编辑", style: "cancel" },
      { text: "放弃修改", style: "destructive", onPress: onClose },
      { text: "保存", onPress: save },
    ]);
  };
  const chooseProvider = () =>
    choices("服务商", Object.keys(presets), (value) => {
      const provider = value as Provider;
      update({ provider, name: provider, ...presets[provider], search: false });
    });
  const searchAvailable =
    draft.provider === "OpenAI" || draft.provider === "Anthropic";
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={false}
      onRequestClose={advanced ? leaveAdvanced : close}
    >
      <DemoEditorLayout
        title={
          advanced ? "高级设置" : initial.id ? "编辑 AI 服务" : "添加 AI 服务"
        }
        onLeadingAction={advanced ? leaveAdvanced : close}
        leadingIsBack={advanced}
        {...(!advanced ? { onSave: save } : {})}
        fallbackHeader={
          <Header
            title={
              advanced
                ? "高级设置"
                : initial.id
                  ? "编辑 AI 服务"
                  : "添加 AI 服务"
            }
            backTitle={advanced ? undefined : "取消"}
            onBack={advanced ? leaveAdvanced : close}
            {...(!advanced ? { action: "保存", onAction: save } : {})}
          />
        }
      >
        <ScrollView
          style={s.screen}
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={s.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          {advanced ? (
            <>
              <Text style={s.label}>上下文窗口</Text>
              <View style={s.group}>
                <View style={s.toggle}>
                  <Text style={s.rowTitle}>自动</Text>
                  <Switch
                    accessibilityLabel="自动设置上下文窗口"
                    value={draft.window === "自动"}
                    onValueChange={(automatic) => {
                      update({ window: automatic ? "自动" : manualWindow });
                      setWindowError("");
                    }}
                    trackColor={{ false: c.line, true: c.accent }}
                  />
                </View>
                {draft.window !== "自动" && (
                  <Field
                    label="Token 数"
                    value={draft.window}
                    onChange={(window) => {
                      setManualWindow(window);
                      update({ window });
                      setWindowError("");
                    }}
                    placeholder="例如 1M、200K 或 1047576"
                  />
                )}
              </View>
              <Text style={s.hint}>
                {draft.window === "自动"
                  ? "自动值将在接入模型资料后显示。"
                  : "1M = 1,000,000 Token。按服务商提供的数值填写。"}
              </Text>
              {!!windowError && (
                <Text style={s.error} accessibilityLiveRegion="polite">
                  {windowError}
                </Text>
              )}
              <View style={[s.group, s.sectionGap]}>
                <Row
                  title="接口格式"
                  detail={draft.protocol}
                  onPress={() =>
                    choices("接口格式", ["OpenAI", "Anthropic"], (protocol) =>
                      update({ protocol }),
                    )
                  }
                />
              </View>
              <Text style={s.hint}>不确定时保留默认值，返回后统一保存。</Text>
            </>
          ) : (
            <>
              <View style={s.group}>
                <Row
                  title="服务商"
                  detail={draft.provider}
                  onPress={chooseProvider}
                />
                <Field
                  label="名称"
                  value={draft.name}
                  onChange={(name) => update({ name })}
                />
                <Field
                  label="地址"
                  value={draft.url}
                  onChange={(url) => update({ url })}
                  placeholder="https://"
                  url
                />
                <Field
                  label="模型"
                  value={draft.model}
                  onChange={(model) => update({ model })}
                  placeholder="填写模型 ID"
                />
                <Field
                  label="API Key（仅示例）"
                  value={draft.key === "sample-key" ? "" : draft.key}
                  onChange={(key) =>
                    update({
                      key:
                        key ||
                        (initial.key === "sample-key" ? "sample-key" : ""),
                    })
                  }
                  placeholder={
                    draft.key === "sample-key"
                      ? "已有示例，留空保留"
                      : "填 demo 即可，不要填真实密钥"
                  }
                />
              </View>
              {error ? (
                <Text style={s.error} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : null}
              <View style={[s.group, s.sectionGap]}>
                {searchAvailable ? (
                  <View style={s.toggle}>
                    <Text style={s.rowTitle}>联网搜索</Text>
                    <Switch
                      accessibilityLabel="联网搜索"
                      value={draft.search}
                      onValueChange={(search) => update({ search })}
                      trackColor={{ false: c.line, true: c.accent }}
                    />
                  </View>
                ) : (
                  <View style={s.staticRow}>
                    <Text style={s.rowTitle}>联网搜索</Text>
                    <Text style={s.detail}>当前服务不支持</Text>
                  </View>
                )}
                <Row title="高级设置" onPress={() => setAdvanced(true)} />
              </View>
              <Text style={s.hint}>保存后，下一次提问生效。</Text>
              {initial.id && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="删除 AI 服务"
                  style={[s.delete, s.sectionGap]}
                  onPress={onRemove}
                >
                  <Text style={s.deleteText}>删除 AI 服务</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </DemoEditorLayout>
    </Modal>
  );
}
export function ModelDemoHeader({
  title,
  onBack,
  action,
  onAction,
}: {
  title: string;
  onBack: () => void;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Header
      title={title}
      onBack={onBack}
      {...(action !== undefined ? { action } : {})}
      {...(onAction ? { onAction } : {})}
    />
  );
}
function Header({
  title,
  onBack,
  backTitle,
  action,
  onAction,
}: {
  title: string;
  onBack: () => void;
  backTitle?: string | undefined;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backTitle ?? "返回"}
        onPress={onBack}
        style={s.headerAction}
      >
        {backTitle ? (
          <Text style={s.actionText}>{backTitle}</Text>
        ) : (
          <ChevronLeft color={c.ink} size={23} />
        )}
      </Pressable>
      <Text style={s.headerTitle} accessibilityRole="header">
        {title}
      </Text>
      {onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onAction}
          style={s.headerAction}
        >
          <Text style={[s.actionText, s.save]}>{action}</Text>
        </Pressable>
      ) : (
        <View style={s.headerAction} />
      )}
    </View>
  );
}
function Field({
  label,
  value,
  onChange,
  placeholder,
  url,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  url?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        autoComplete="off"
        textContentType="none"
        keyboardType={url ? "url" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        style={s.input}
      />
    </View>
  );
}
function Row({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityValue={detail ? { text: detail } : undefined}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <Text style={s.rowTitle}>{title}</Text>
      {detail && <Text style={s.detail}>{detail}</Text>}
      <ChevronRight size={16} color={c.muted} accessible={false} />
    </Pressable>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  headerAction: {
    minWidth: 52,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: c.ink,
    fontSize: 17,
    fontWeight: "600",
  },
  actionText: { fontSize: 17, color: c.ink },
  save: { color: c.accent, fontWeight: "600" },
  content: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  label: {
    color: c.secondary,
    fontSize: 13,
    marginHorizontal: 4,
    marginBottom: 10,
  },
  sectionGap: { marginTop: 28 },
  group: {
    backgroundColor: c.surface,
    borderRadius: 16,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  rowTitle: { color: c.ink, fontSize: 17, lineHeight: 25, flexShrink: 1 },
  detail: { color: c.secondary, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  row: {
    minHeight: 60,
    paddingHorizontal: 17,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  field: {
    paddingHorizontal: 17,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
  },
  fieldLabel: { fontSize: 12, lineHeight: 18, color: c.secondary },
  input: { minHeight: 36, fontSize: 16, color: c.ink, paddingVertical: 7 },
  hint: {
    fontSize: 12,
    color: c.secondary,
    lineHeight: 20,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  error: { fontSize: 13, color: "#A33232", marginTop: 12, lineHeight: 20 },
  toggle: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 17,
    gap: 12,
  },
  staticRow: {
    minHeight: 60,
    padding: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  delete: {
    backgroundColor: c.surface,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  deleteText: { fontSize: 17, color: "#A33232" },
  pressed: { opacity: 0.55 },
});
