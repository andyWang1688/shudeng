import { useMemo } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FileText, Hand } from "lucide-react-native";
import { font, usePalette, type Palette } from "../../../src/ui/theme";
import {
  SettingsHeader,
  SettingsRow,
  SettingsSection,
} from "../../../src/ui/settings/SettingsParts";
import thirdPartyNotices from "../../../src/ui/settings/thirdPartyNotices.json";

const APP_VERSION = "0.5.0";

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

/** 关于书灯与本机隐私、第三方许可说明。 */
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
        <ScrollView
          contentContainerStyle={styles.panelContent}
          showsVerticalScrollIndicator={false}
        >
          {sheet === "licenses" ? (
            <Text selectable style={styles.paragraphBody}>
              {thirdPartyNotices.text}
            </Text>
          ) : (
            PRIVACY.map((paragraph) => (
              <View key={paragraph.heading} style={styles.paragraph}>
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
              style={{ width: 40, height: 40, tintColor: palette.lampInk }}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.wordmark}>书灯</Text>
          <Text style={styles.version}>版本 {APP_VERSION}</Text>
        </View>

        <SettingsSection first>
          <SettingsRow
            title="隐私政策"
            leading={<Hand size={21} color={palette.ink2} accessible={false} />}
            onPress={() =>
              router.push({
                pathname: "/about",
                params: { content: "privacy" },
              })
            }
          />
          <SettingsRow
            title="第三方许可"
            leading={
              <FileText size={21} color={palette.ink2} accessible={false} />
            }
            onPress={() =>
              router.push({
                pathname: "/about",
                params: { content: "licenses" },
              })
            }
          />
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    content: {
      paddingHorizontal: 24,
      paddingTop: 34,
      paddingBottom: 40,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
    },
    brand: { alignItems: "center", paddingBottom: 26 },
    lamp: {
      width: 56,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.lampWash,
      borderRadius: 17,
      borderCurve: "continuous",
    },
    wordmark: {
      marginTop: 12,
      fontSize: 27,
      lineHeight: 36,
      fontFamily: font.serif,
      color: palette.ink,
    },
    version: {
      marginTop: 8,
      fontSize: 13,
      lineHeight: 20,
      color: palette.ink3,
    },
    panelContent: {
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 40,
      gap: 28,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
    },
    paragraph: { gap: 8 },
    paragraphHeading: {
      fontSize: 17,
      lineHeight: 25,
      fontWeight: "600",
      color: palette.ink,
    },
    paragraphBody: { fontSize: 16, lineHeight: 26, color: palette.ink2 },
  });
}
