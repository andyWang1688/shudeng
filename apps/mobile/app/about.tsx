import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { font, radius, spacing, type, usePalette, type Palette } from '../src/ui/theme';

const APP_VERSION = '0.4.8';
const MOTTO = '一盏照书的灯，AI 照亮你读不懂的地方';

type SheetKind = 'privacy' | 'licenses';

/** 与 Swift 版「关于书灯 → 隐私政策」同一份文案。 */
const PRIVACY: ReadonlyArray<{ readonly heading: string; readonly body: string }> = [
  {
    heading: '本机存储',
    body: '书灯将导入的书籍、阅读位置、笔记、书签、书内检索资料和问答记录存储在本机。API Key 存储在设备 Keychain，不写入书灯导出的阅读数据。请妥善保管你自行导出的文件及设备备份。',
  },
  {
    heading: '外部 AI 服务',
    body: '使用 AI 问答时，问题、相关原文和必要对话会发送到你所选的服务地址；相关原文可能来自其他章节。自定义代理也可能接收请求。保存或切换服务时确认发送说明，地址、服务商或接口格式改变时重新确认。连接检查会发送固定短文字。',
  },
  {
    heading: '服务费用',
    body: 'AI 服务由你自行配置，可能按请求或用量收费。检查连接也可能产生费用。书灯不提供、代付或保证第三方额度，请查看所选服务的价格与条款。',
  },
  {
    heading: '保留与删除',
    body: '本机阅读资料和问答记录会保留供你回看，直到你删除相应内容或由系统移除应用数据。自行导出的副本需自行删除。删除 AI 服务会尝试清理对应 Keychain 条目；卸载应用不保证清除 Keychain。发送到第三方的内容按该服务的政策保留，书灯无法代为保证其删除或保留期限。',
  },
  {
    heading: '使用边界',
    body: '本机检索不意味着 AI 全程离线。AI 回答可能不准确，有限的原文片段不代表完整阅读全书；请核对引用和原文。发送书内内容前请确认你有相应使用权限。此页说明当前产品行为，不代表已经过法律审查。',
  },
];

const LICENSES: ReadonlyArray<{ readonly heading: string; readonly body: string }> = [
  {
    heading: '开源软件',
    body: '书灯使用 React Native、Expo、Readium、pdf.js、LangChain、Drizzle ORM 等开源软件构建。',
  },
  {
    heading: '主要许可',
    body: 'React Native / Expo / React — MIT；Readium — BSD-3-Clause；pdf.js — Apache-2.0；LangChain — MIT；Drizzle ORM — Apache-2.0；react-native-webview — MIT。',
  },
  {
    heading: '完整文本',
    body: '完整第三方许可文本随发布包提供（ThirdPartyNotices.txt），也可在 GitHub Release 附件中查看。',
  },
];

/** 关于书灯：品牌灯标 + 书灯 + motto + 版本，以及隐私政策 / 第三方许可说明。 */
export default function AboutRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const paragraphs = sheet === 'privacy' ? PRIVACY : sheet === 'licenses' ? LICENSES : [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回我的" onPress={() => router.back()}>
          <Text style={styles.back}>‹ 我的</Text>
        </Pressable>
        <Text style={styles.title}>关于书灯</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <View style={styles.lamp}>
            <SymbolView name="lightbulb" size={64} tintColor={palette.lampInk} />
          </View>
          <Text style={styles.wordmark}>书灯</Text>
          <Text style={styles.motto}>{MOTTO}</Text>
          <Text style={styles.version}>版本 {APP_VERSION}</Text>
        </View>

        <Text style={styles.sectionHeader}>关于</Text>
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="隐私政策"
            onPress={() => setSheet('privacy')}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="hand.raised" size={20} tintColor={palette.ink2} />
            </View>
            <View style={styles.rowBody}><Text style={styles.rowTitle}>隐私政策</Text></View>
            <SymbolView name="chevron.right" size={17} tintColor={palette.ink3} />
          </Pressable>
          <View style={styles.separator} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="第三方许可"
            onPress={() => setSheet('licenses')}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="doc.text" size={20} tintColor={palette.ink2} />
            </View>
            <View style={styles.rowBody}><Text style={styles.rowTitle}>第三方许可</Text></View>
            <SymbolView name="chevron.right" size={17} tintColor={palette.ink3} />
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <View style={styles.backdrop}>
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>{sheet === 'privacy' ? '隐私政策' : '第三方许可'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={() => setSheet(null)}>
                <Text style={styles.panelClose}>完成</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.panelContent}>
              {paragraphs.map((paragraph) => (
                <View key={paragraph.heading} style={styles.paragraph}>
                  <Text style={styles.paragraphHeading}>{paragraph.heading}</Text>
                  <Text style={styles.paragraphBody}>{paragraph.body}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
    back: { fontSize: 15, color: palette.lamp },
    title: { fontSize: 17, fontWeight: '600', color: palette.ink },
    content: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: 24 },
    brand: { alignItems: 'center' },
    lamp: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
    wordmark: { marginTop: spacing.md, fontSize: 22, fontWeight: '600', fontFamily: font.serif, color: palette.ink },
    motto: { marginTop: spacing.xs, fontSize: 12.5, lineHeight: 18, textAlign: 'center', color: palette.ink2 },
    version: { marginTop: spacing.xs, fontSize: type.caption, color: palette.ink3 },
    sectionHeader: { marginTop: spacing.lg, marginBottom: spacing.xs, paddingHorizontal: spacing.xxs, fontSize: type.subhead, color: palette.ink3 },
    card: { backgroundColor: palette.surface, borderRadius: radius.field, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, overflow: 'hidden' },
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
    pressed: { opacity: 0.7 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line, marginLeft: spacing.md + 26 + spacing.sm },
    iconSlot: { width: 26 },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: type.body, color: palette.ink },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end' },
    panel: { maxHeight: '86%', backgroundColor: palette.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
    panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
    panelTitle: { fontSize: 16, fontWeight: '600', color: palette.ink },
    panelClose: { fontSize: 14, color: palette.lamp },
    panelContent: { padding: spacing.md, gap: spacing.lg },
    paragraph: { gap: 6 },
    paragraphHeading: { fontSize: 15, fontWeight: '600', color: palette.ink },
    paragraphBody: { fontSize: 14, lineHeight: 22, color: palette.ink2 },
  });
}
