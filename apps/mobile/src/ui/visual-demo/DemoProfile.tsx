/** Visual prototype. Settings stay in memory. */
import { useState } from "react";
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
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Palette,
  Sparkles,
} from "lucide-react-native";
import { demoColors as c } from "./demoTheme";

type Page = "home" | "assistant" | "appearance" | "about";

export function DemoProfile() {
  const initialDetail = process.env.EXPO_PUBLIC_UI_DEMO_DETAIL;
  const [page, setPage] = useState<Page>(
    initialDetail === "appearance" ||
      initialDetail === "assistant" ||
      initialDetail === "about"
      ? initialDetail
      : "home",
  );
  const [webSearch, setWebSearch] = useState(true);
  const [instructions, setInstructions] = useState(
    "先从书中寻找依据，清楚区分原文与推断。",
  );
  const [appearance, setAppearance] = useState<"green" | "warm">("green");
  const preview =
    appearance === "green"
      ? { paper: c.paper, ink: c.ink, accent: c.accent }
      : { paper: "#FAF6EF", ink: "#352E24", accent: "#8B663C" };
  const title =
    page === "assistant"
      ? "AI 与助手"
      : page === "appearance"
        ? "外观"
        : page === "about"
          ? "关于书灯"
          : "我的";

  return (
    <View style={s.screen}>
      {page !== "home" && (
        <View style={s.navigation}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回我的"
            onPress={() => setPage("home")}
            style={s.back}
          >
            <ChevronLeft size={23} color={c.accent} />
            <Text style={s.backText}>我的</Text>
          </Pressable>
          <Text accessibilityRole="header" style={s.navigationTitle}>
            {title}
          </Text>
          <View style={s.navigationBalance} />
        </View>
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {page === "home" && (
          <>
            <Text accessibilityRole="header" style={s.title}>
              我的
            </Text>
            <View style={s.group}>
              <Pressable
                style={s.row}
                onPress={() => setPage("assistant")}
                accessibilityRole="button"
              >
                <Sparkles size={21} color={c.secondary} strokeWidth={1.6} />
                <Text style={s.rowTitle}>AI 与助手</Text>
                <ChevronRight size={17} color={c.muted} />
              </Pressable>
              <View style={s.iconDivider} />
              <Pressable
                style={s.row}
                onPress={() => setPage("appearance")}
                accessibilityRole="button"
              >
                <Palette size={21} color={c.secondary} strokeWidth={1.6} />
                <Text style={s.rowTitle}>外观</Text>
                <Text style={s.rowValue}>
                  {appearance === "green" ? "纸白墨绿" : "暖纸"}
                </Text>
                <ChevronRight size={17} color={c.muted} />
              </Pressable>
              <View style={s.iconDivider} />
              <Pressable
                style={s.row}
                onPress={() => setPage("about")}
                accessibilityRole="button"
              >
                <CircleHelp size={21} color={c.secondary} strokeWidth={1.6} />
                <Text style={s.rowTitle}>关于书灯</Text>
                <ChevronRight size={17} color={c.muted} />
              </Pressable>
            </View>
          </>
        )}
        {page === "assistant" && (
          <>
            <Text style={s.sectionLabel}>模型</Text>
            <View style={s.group}>
              <View style={s.row}>
                <Text style={s.rowTitle}>OpenAI</Text>
                <Text style={s.rowValue}>GPT-4.1</Text>
              </View>
              <View style={s.divider} />
              <View style={s.row}>
                <Text style={s.rowTitle}>联网搜索</Text>
                <Switch
                  accessibilityLabel="联网搜索"
                  value={webSearch}
                  onValueChange={setWebSearch}
                  trackColor={{ false: "#DCE3D9", true: c.accent }}
                  thumbColor={c.surface}
                />
              </View>
            </View>
            <Text style={s.fieldHint}>由当前模型搜索网页，可能产生费用。</Text>
            <Text style={[s.sectionLabel, s.nextSection]}>助手指令</Text>
            <TextInput
              accessibilityLabel="助手指令"
              value={instructions}
              onChangeText={setInstructions}
              multiline
              style={s.instructions}
              textAlignVertical="top"
            />
          </>
        )}
        {page === "appearance" && (
          <>
            <Text style={s.sectionLabel}>配色</Text>
            <View style={s.group}>
              <Pressable
                style={s.row}
                onPress={() => setAppearance("green")}
                accessibilityRole="radio"
                accessibilityState={{ checked: appearance === "green" }}
              >
                <View style={[s.swatch, { backgroundColor: c.accent }]} />
                <Text style={s.rowTitle}>纸白墨绿</Text>
                {appearance === "green" && <Check size={19} color={c.accent} />}
              </Pressable>
              <View style={s.iconDivider} />
              <Pressable
                style={s.row}
                onPress={() => setAppearance("warm")}
                accessibilityRole="radio"
                accessibilityState={{ checked: appearance === "warm" }}
              >
                <View style={[s.swatch, { backgroundColor: "#8B663C" }]} />
                <Text style={s.rowTitle}>暖纸</Text>
                {appearance === "warm" && <Check size={19} color={c.accent} />}
              </Pressable>
            </View>
            <Text style={[s.sectionLabel, s.nextSection]}>预览</Text>
            <View style={[s.preview, { backgroundColor: preview.paper }]}>
              <Text style={[s.previewBook, { color: preview.accent }]}>
                瓦尔登湖
              </Text>
              <Text style={[s.previewQuote, { color: preview.ink }]}>
                我到树林里去，是因为我希望有目的地生活。
              </Text>
            </View>
          </>
        )}
        {page === "about" && (
          <>
            <View style={s.aboutBrand}>
              <Text style={s.aboutTitle}>书灯</Text>
              <Text style={s.rowValue}>UI Demo</Text>
            </View>
            <Text style={s.aboutText}>
              当前使用示例数据，设置仅在本次预览中生效。
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32 },
  title: {
    color: c.ink,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginBottom: 28,
  },
  navigation: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 78,
    minHeight: 44,
    gap: 2,
  },
  backText: { color: c.accent, fontSize: 17, lineHeight: 24 },
  navigationTitle: {
    flex: 1,
    textAlign: "center",
    color: c.ink,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600",
  },
  navigationBalance: { width: 78 },
  sectionLabel: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 9,
    paddingHorizontal: 16,
  },
  nextSection: { marginTop: 28 },
  group: {
    backgroundColor: c.surface,
    borderRadius: 12,
    borderCurve: "continuous",
  },
  row: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowTitle: { flex: 1, color: c.ink, fontSize: 17, lineHeight: 24 },
  rowValue: { color: c.muted, fontSize: 14, lineHeight: 21 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.line,
    marginLeft: 16,
  },
  iconDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.line,
    marginLeft: 49,
  },
  fieldHint: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    paddingHorizontal: 16,
  },
  instructions: {
    minHeight: 124,
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 16,
    color: c.ink,
    fontSize: 16,
    lineHeight: 26,
  },
  swatch: { height: 20, width: 20, borderRadius: 10 },
  preview: {
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.line,
    borderRadius: 12,
    gap: 14,
  },
  previewBook: { fontSize: 13, lineHeight: 19, fontWeight: "500" },
  previewQuote: { fontFamily: "Songti SC", fontSize: 18, lineHeight: 30 },
  aboutBrand: { alignItems: "center", gap: 10, paddingVertical: 30 },
  aboutTitle: {
    color: c.ink,
    fontFamily: "Songti SC",
    fontSize: 34,
    lineHeight: 44,
  },
  aboutText: {
    color: c.secondary,
    fontSize: 15,
    lineHeight: 25,
    marginTop: 20,
  },
});
