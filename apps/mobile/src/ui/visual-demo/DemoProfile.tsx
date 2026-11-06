/** Visual prototype. Settings stay in memory; no service configuration is changed. */
import { useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  SlidersHorizontal,
  BookOpen,
} from "lucide-react-native";
import { DemoHeading } from "./DemoChrome";
import { demoColors as c } from "./demoTheme";

type Page = "home" | "assistant" | "service" | "about";
export function DemoProfile() {
  const detail = process.env.EXPO_PUBLIC_UI_DEMO_DETAIL;
  const [page, setPage] = useState<Page>(
    detail === "assistant" || detail === "about" ? detail : "home",
  );
  const [web, setWeb] = useState(true);
  const [text, setText] = useState("先从书中寻找依据，清楚区分原文与推断。");
  const title = {
    home: "我的",
    assistant: "AI 与助手",
    service: "OpenAI",
    about: "关于书灯",
  }[page];
  return (
    <View style={s.screen}>
      {page === "home" ? (
        <DemoHeading title="我的" />
      ) : (
        <View style={s.navigation}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => setPage(page === "service" ? "assistant" : "home")}
            style={s.back}
          >
            <ChevronLeft size={24} color={c.ink} />
          </Pressable>
          <Text accessibilityRole="header" style={s.navTitle}>
            {title}
          </Text>
          <View style={s.balance} />
        </View>
      )}
      <ScrollView
        bounces
        alwaysBounceVertical
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
      >
        {page === "home" && (
          <>
            <View style={s.identity}>
              <View style={s.appMark}>
                <BookOpen size={25} color={c.accent} strokeWidth={1.6} />
              </View>
              <Text style={s.brand}>书灯</Text>
            </View>
            <View style={s.group}>
              <Row
                icon={<SlidersHorizontal size={21} color={c.secondary} />}
                label="AI 与助手"
                onPress={() => setPage("assistant")}
              />
              <Row
                icon={<CircleHelp size={21} color={c.secondary} />}
                label="关于书灯"
                onPress={() => setPage("about")}
                last
              />
            </View>
          </>
        )}
        {page === "assistant" && (
          <>
            <Text style={s.label}>模型服务</Text>
            <View style={s.group}>
              <Row
                label="OpenAI"
                value="GPT-4.1"
                onPress={() => setPage("service")}
                last
              />
            </View>
            <Text style={[s.label, s.sectionGap]}>助手指令</Text>
            <TextInput
              accessibilityLabel="助手指令"
              value={text}
              onChangeText={setText}
              multiline
              style={s.instructions}
              textAlignVertical="top"
            />
          </>
        )}
        {page === "service" && (
          <>
            <Text style={s.label}>模型</Text>
            <View style={s.group}>
              <View style={s.valueRow}>
                <Text style={s.rowText}>当前模型</Text>
                <Text style={s.value}>GPT-4.1</Text>
              </View>
            </View>
            <Text style={[s.label, s.sectionGap]}>模型能力</Text>
            <View style={s.group}>
              <View style={s.valueRow}>
                <Text style={s.rowText}>联网搜索</Text>
                <Switch
                  accessibilityLabel="联网搜索"
                  value={web}
                  onValueChange={setWeb}
                  trackColor={{ false: c.line, true: c.accent }}
                  thumbColor={c.surface}
                />
              </View>
            </View>
            <Text style={s.hint}>由模型服务提供，可能产生额外费用。</Text>
          </>
        )}
        {page === "about" && (
          <View style={s.about}>
            <View style={s.appMark}>
              <BookOpen size={25} color={c.accent} />
            </View>
            <Text style={s.brand}>书灯</Text>
            <Text style={s.hint}>界面设计预览 · 示例数据</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
function Row({
  label,
  value,
  icon,
  onPress,
  last,
}: {
  label: string;
  value?: string;
  icon?: ReactNode;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        !last && s.rowLine,
        pressed && { opacity: 0.6 },
      ]}
    >
      {icon}
      <Text style={s.rowText}>{label}</Text>
      {value && <Text style={s.value}>{value}</Text>}
      <ChevronRight size={17} color={c.muted} />
    </Pressable>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  identity: {
    flexDirection: "row",
    gap: 15,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 38,
  },
  appMark: {
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
  navigation: {
    minHeight: 56,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  back: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  balance: { width: 44 },
  navTitle: {
    flex: 1,
    color: c.ink,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  group: {
    backgroundColor: c.surface,
    borderRadius: 16,
    paddingHorizontal: 17,
    borderCurve: "continuous",
  },
  row: {
    flexDirection: "row",
    gap: 13,
    alignItems: "center",
    minHeight: 62,
    paddingVertical: 16,
  },
  rowLine: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  rowText: { flex: 1, fontSize: 17, lineHeight: 25, color: c.ink },
  value: { color: c.secondary, fontSize: 14, lineHeight: 22 },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    paddingVertical: 12,
  },
  label: {
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
    marginLeft: 4,
    marginBottom: 10,
  },
  sectionGap: { marginTop: 32 },
  hint: {
    color: c.secondary,
    fontSize: 13,
    lineHeight: 21,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  instructions: {
    minHeight: 160,
    padding: 17,
    borderRadius: 16,
    backgroundColor: c.surface,
    fontSize: 17,
    lineHeight: 28,
    color: c.ink,
  },
  about: { alignItems: "center", paddingTop: 48, gap: 15 },
});
