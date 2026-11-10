/** Profile hierarchy prototype. All samples and drafts live only in memory. */
import { useState, type ReactNode } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  Download,
  FilePenLine,
  SlidersHorizontal,
} from "lucide-react-native";
import { DemoHeading } from "./DemoChrome";
import {
  DemoModelSettings,
  ModelDemoHeader,
  sampleServices,
  type DemoService,
} from "./DemoModelSettings";
import { demoColors as c } from "./demoTheme";

type Page = "home" | "models" | "assistant" | "semantic" | "about";
const defaultInstructions = "先从书中寻找依据，清楚区分原文与推断。";
const pageTitles = {
  assistant: "助手指令",
  semantic: "离线语义资料",
  about: "关于书灯",
};
export function DemoProfile() {
  const detail = process.env.EXPO_PUBLIC_UI_DEMO_DETAIL;
  const [page, setPage] = useState<Page>(
    detail === "models"
      ? "models"
      : detail && detail in pageTitles
        ? (detail as Page)
        : "home",
  );
  const [services, setServices] = useState<DemoService[]>(sampleServices);
  const [selectedId, setSelectedId] = useState("deepseek");
  const [instructions, setInstructions] = useState(defaultInstructions);
  const [draft, setDraft] = useState(defaultInstructions);
  const [saved, setSaved] = useState(false);
  const selected = services.find((service) => service.id === selectedId);
  const save = (service: DemoService) =>
    setServices((old) =>
      old.some((item) => item.id === service.id)
        ? old.map((item) => (item.id === service.id ? service : item))
        : [...old, service],
    );
  const remove = (id: string) => {
    setServices((old) => old.filter((service) => service.id !== id));
    if (id === selectedId) setSelectedId("");
  };
  const navigate = (next: Page) => {
    Keyboard.dismiss();
    setSaved(false);
    setPage(next);
  };
  if (page === "models")
    return (
      <DemoModelSettings
        services={services}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onSave={save}
        onRemove={remove}
        onBack={() => navigate("home")}
      />
    );
  return (
    <View style={s.screen}>
      {page === "home" ? (
        <DemoHeading title="我的" />
      ) : (
        <ModelDemoHeader
          title={pageTitles[page]}
          onBack={() => navigate("home")}
          {...(page === "assistant"
            ? {
                action: "保存",
                onAction: () => {
                  Keyboard.dismiss();
                  setInstructions(draft);
                  setSaved(true);
                },
              }
            : {})}
        />
      )}
      <ScrollView
        key={page}
        contentContainerStyle={s.content}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {page === "home" && (
          <>
            <Section title="AI 与助手" first>
              <Row
                icon={SlidersHorizontal}
                title="AI 服务"
                value={selected?.name ?? "未选择"}
                onPress={() => navigate("models")}
              />
              <Row
                icon={FilePenLine}
                title="助手指令"
                onPress={() => navigate("assistant")}
              />
              <Row
                icon={Download}
                title="离线语义资料"
                value="未下载"
                onPress={() => navigate("semantic")}
                last
              />
            </Section>
            <Section title="通用">
              <Row
                icon={CircleHelp}
                title="关于书灯"
                onPress={() => navigate("about")}
                last
              />
            </Section>
          </>
        )}
        {page === "assistant" && (
          <>
            <Text style={s.hint}>人设、语气与回答偏好，适用于所有书籍。</Text>
            <TextInput
              accessibilityLabel="助手指令，支持 Markdown"
              multiline
              textAlignVertical="top"
              value={draft}
              onChangeText={(value) => {
                setDraft(value);
                setSaved(false);
              }}
              placeholder="写下你希望助手如何与你交流…"
              placeholderTextColor={c.muted}
              style={s.instructions}
            />
            <Text style={s.hint} accessibilityLiveRegion="polite">
              {saved
                ? "已保存，下一次提问生效。"
                : draft !== instructions
                  ? "有未保存的修改"
                  : "支持 Markdown，保存后下一次提问生效。"}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={s.textAction}
              onPress={() => {
                setDraft(defaultInstructions);
                setSaved(false);
              }}
            >
              <Text style={s.actionText}>恢复默认</Text>
            </Pressable>
          </>
        )}
        {page === "semantic" && (
          <>
            <Section title="检索资料" first>
              <View style={s.infoRow}>
                <Download size={24} color={c.accent} accessible={false} />
                <View style={s.rowText}>
                  <Text style={s.title}>离线语义资料</Text>
                  <Text style={s.detail}>未下载 · 约 81 MB</Text>
                </View>
              </View>
            </Section>
            <Text style={s.hint}>
              用于书内语义检索。阅读、原文搜索与标注无需下载。
            </Text>
            <Pressable
              accessibilityRole="button"
              style={s.primary}
              onPress={() =>
                Alert.alert(
                  "界面预览",
                  "此 Demo 不下载文件，也不会准备书籍索引。",
                )
              }
            >
              <Text style={s.primaryText}>下载资料</Text>
            </Pressable>
            <Text style={s.hint}>
              下载完成后，各本书还需准备自己的检索索引。
            </Text>
          </>
        )}
        {page === "about" && (
          <View style={s.about}>
            <View style={s.mark}>
              <BookOpen size={25} color={c.accent} accessible={false} />
            </View>
            <Text style={s.brand}>书灯</Text>
            <Text style={s.detail}>交互预览 · 示例配置</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
function Section({
  title,
  first,
  children,
}: {
  title: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={!first && s.sectionGap}>
      <Text accessibilityRole="header" style={s.label}>
        {title}
      </Text>
      <View style={s.group}>{children}</View>
    </View>
  );
}
function Row({
  icon: Icon,
  title,
  detail,
  value,
  onPress,
  last,
}: {
  icon: typeof BookOpen;
  title: string;
  detail?: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, detail, value].filter(Boolean).join("，")}
      onPress={onPress}
      style={({ pressed }) => [s.row, !last && s.line, pressed && s.pressed]}
    >
      <Icon size={21} color={c.secondary} accessible={false} />
      <View style={s.rowText}>
        <Text style={s.title}>{title}</Text>
        {detail && <Text style={s.detail}>{detail}</Text>}
      </View>
      {value && <Text style={s.value}>{value}</Text>}
      <ChevronRight size={17} color={c.muted} accessible={false} />
    </Pressable>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 30,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  sectionGap: { marginTop: 24 },
  label: {
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
    marginLeft: 16,
    marginBottom: 8,
  },
  group: {
    backgroundColor: c.surface,
    borderRadius: 16,
    paddingHorizontal: 17,
    borderCurve: "continuous",
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 15,
  },
  line: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 17, lineHeight: 25, color: c.ink, flexShrink: 1 },
  detail: { color: c.secondary, fontSize: 14, lineHeight: 22 },
  value: { color: c.secondary, fontSize: 14, lineHeight: 22, flexShrink: 1 },
  hint: {
    fontSize: 14,
    lineHeight: 23,
    color: c.secondary,
    marginHorizontal: 4,
    marginTop: 12,
  },
  instructions: {
    minHeight: 260,
    marginTop: 20,
    borderRadius: 16,
    padding: 17,
    backgroundColor: c.surface,
    color: c.ink,
    fontSize: 17,
    lineHeight: 28,
  },
  textAction: {
    minHeight: 48,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
    marginTop: 8,
  },
  actionText: { fontSize: 16, color: c.accent },
  infoRow: {
    minHeight: 76,
    paddingVertical: 17,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  primary: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 26,
    padding: 12,
  },
  primaryText: { fontSize: 17, fontWeight: "600", color: c.surface },
  about: { alignItems: "center", paddingTop: 48, gap: 15 },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 17,
    backgroundColor: c.accentWash,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: c.ink,
    fontFamily: "Songti SC",
    fontSize: 27,
    lineHeight: 36,
  },
  pressed: { opacity: 0.6 },
});
