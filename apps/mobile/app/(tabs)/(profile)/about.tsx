import { useMemo } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  font,
  spacing,
  type,
  usePalette,
  type Palette,
} from "../../../src/ui/theme";
import { SettingsHeader } from "../../../src/ui/settings/SettingsParts";
import thirdPartyNotices from "../../../src/ui/settings/thirdPartyNotices.json";

const APP_VERSION = "0.4.8";
const MOTTO = "一盏照书的灯，AI 照亮你读不懂的地方";

/** 与 Swift 版「关于书灯 → 隐私政策」同一份文案。 */
const PRIVACY: ReadonlyArray<{
  readonly heading: string;
  readonly body: string;
}> = [
  {
    heading: "本机存储",
    body: "书灯将导入的书籍、阅读位置、笔记、书签、书内检索资料和问答记录存储在本机。API Key 存储在设备 Keychain，不写入书灯导出的阅读数据。请妥善保管你自行导出的文件及设备备份。",
  },
  {
    heading: "外部 AI 服务",
    body: "使用 AI 问答时，问题、相关原文和必要对话会发送到你所选的服务地址；相关原文可能来自其他章节。自定义代理也可能接收请求。保存或切换服务时确认发送说明，地址、服务商或接口格式改变时重新确认。连接检查会发送固定短文字。",
  },
  {
    heading: "服务费用",
    body: "AI 服务由你自行配置，可能按请求或用量收费。检查连接也可能产生费用。书灯不提供、代付或保证第三方额度，请查看所选服务的价格与条款。",
  },
  {
    heading: "保留与删除",
    body: "本机阅读资料和问答记录会保留供你回看，直到你删除相应内容或由系统移除应用数据。自行导出的副本需自行删除。删除 AI 服务会尝试清理对应 Keychain 条目；卸载应用不保证清除 Keychain。发送到第三方的内容按该服务的政策保留，书灯无法代为保证其删除或保留期限。",
  },
  {
    heading: "使用边界",
    body: "本机检索不意味着 AI 全程离线。AI 回答可能不准确，有限的原文片段不代表完整阅读全书；请核对引用和原文。发送书内内容前请确认你有相应使用权限。此页说明当前产品行为，不代表已经过法律审查。",
  },
];

/** 关于书灯：品牌灯标 + 书灯 + motto + 版本，以及隐私政策 / 第三方许可说明。 */
export default function AboutRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { content } = useLocalSearchParams<{ content?: string }>();
  const sheet =
    content === "privacy" || content === "licenses" ? content : null;
  if (sheet)
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <SettingsHeader
          title={sheet === "privacy" ? "隐私政策" : "第三方许可"}
          onBack={() => router.back()}
          centered
        />
        <ScrollView contentContainerStyle={styles.panelContent}>
          {sheet === "licenses" ? (
            <Text selectable style={styles.paragraphBody}>
              {thirdPartyNotices.text}
            </Text>
          ) : (
            PRIVACY.map((paragraph) => (
              <View
                key={paragraph.heading}
                style={[styles.paragraph, styles.card, { padding: 16 }]}
              >
                <Text style={styles.paragraphHeading}>{paragraph.heading}</Text>
                <Text style={styles.paragraphBody}>{paragraph.body}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <SettingsHeader title="关于书灯" onBack={() => router.back()} centered />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <View style={styles.lamp}>
            <Image
              accessibilityLabel="书灯图标"
              source={require("../../../src/ui/settings/assets/brand-mark-mask.png")}
              style={{ width: 64, height: 64, tintColor: palette.lamp }}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.wordmark}>书灯</Text>
          <Text style={styles.motto}>{MOTTO}</Text>
          <Text style={styles.version}>版本 {APP_VERSION}</Text>
        </View>

        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="隐私政策"
            onPress={() =>
              router.push({
                pathname: "/about",
                params: { content: "privacy" },
              })
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView
                name="hand.raised"
                size={28}
                tintColor={palette.ink2}
              />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>隐私政策</Text>
            </View>
            <SymbolView
              name="chevron.right"
              size={14}
              tintColor={palette.ink3 + "66"}
            />
          </Pressable>
          <View style={styles.separator} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="第三方许可"
            onPress={() =>
              router.push({
                pathname: "/about",
                params: { content: "licenses" },
              })
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="doc.text" size={28} tintColor={palette.ink2} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>第三方许可</Text>
            </View>
            <SymbolView
              name="chevron.right"
              size={14}
              tintColor={palette.ink3 + "66"}
            />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    content: {
      paddingHorizontal: spacing.md,
      paddingTop: 34,
      paddingBottom: 24,
    },
    brand: { alignItems: "center", paddingBottom: 26 },
    lamp: {
      width: 64,
      height: 64,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.lampWash,
      borderColor: palette.line,
      borderWidth: 1,
      borderRadius: 16,
    },
    wordmark: {
      marginTop: 12,
      fontSize: 22,
      fontWeight: "600",
      fontFamily: font.serif,
      color: palette.ink,
    },
    motto: {
      marginTop: 12,
      fontSize: 12.5,
      fontFamily: font.serif,
      lineHeight: 18,
      textAlign: "center",
      color: palette.ink2,
    },
    version: {
      marginTop: 12,
      fontSize: 12,
      fontWeight: "500",
      color: palette.ink3,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: 26,
      overflow: "hidden",
    },
    row: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    pressed: { opacity: 0.7 },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.line,
      marginLeft: 56,
      marginRight: 16,
    },
    iconSlot: { width: 28 },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: type.body, color: palette.ink },
    panelContent: { padding: spacing.md, gap: spacing.lg },
    paragraph: { gap: 6 },
    paragraphHeading: { fontSize: 15, fontWeight: "600", color: palette.ink },
    paragraphBody: { fontSize: 14, lineHeight: 22, color: palette.ink2 },
  });
}
