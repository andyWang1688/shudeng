import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { ChevronRight, CircleHelp, Download, FilePenLine, SlidersHorizontal } from "lucide-react-native";
import { loadAIServiceCatalog } from "../../../src/platform/aiConfig";
import { getSemanticModelState } from "../../../src/platform/semanticModel";
import { PageHeading } from "../../../src/ui/components/PageChrome";
import { SettingsRow, SettingsSection } from "../../../src/ui/settings/SettingsParts";
import { usePalette, type Palette } from "../../../src/ui/theme";

export default function ProfileRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [serviceDetail, setServiceDetail] = useState("读取中…");
  const [semanticDetail, setSemanticDetail] = useState("读取中…");
  useFocusEffect(useCallback(() => {
    let active = true;
    void loadAIServiceCatalog().then((catalog) => {
      if (!active) return;
      const selected = catalog.services.find((service) => service.id === catalog.selectedId);
      setServiceDetail(selected?.name || "未选择");
    }).catch(() => { if (active) setServiceDetail("读取失败"); });
    void getSemanticModelState().then((state) => {
      if (active) setSemanticDetail(state.installed ? "已下载" : "未下载");
    }).catch(() => { if (active) setSemanticDetail("读取失败"); });
    return () => { active = false; };
  }, []));
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeading title="我的" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} bounces alwaysBounceVertical>
        <SettingsSection title="AI 与助手" first>
          <SettingsRow title="AI 服务" accessibilityValue={serviceDetail} leading={<SlidersHorizontal size={21} color={palette.ink2} accessible={false} />}
            trailing={<View style={styles.status}><Text numberOfLines={1} style={styles.value}>{serviceDetail}</Text><ChevronRight size={17} color={palette.ink3} accessible={false} /></View>} onPress={() => router.push("/ai-settings")} />
          <SettingsRow title="助手指令" leading={<FilePenLine size={21} color={palette.ink2} accessible={false} />} onPress={() => router.push("/assistant-settings")} />
          <SettingsRow title="离线语义资料" accessibilityValue={semanticDetail} leading={<Download size={21} color={palette.ink2} accessible={false} />}
            trailing={<View style={styles.status}><Text numberOfLines={1} style={styles.value}>{semanticDetail}</Text><ChevronRight size={17} color={palette.ink3} accessible={false} /></View>} onPress={() => router.push("/semantic-settings")} />
        </SettingsSection>
        <SettingsSection title="通用">
          <SettingsRow title="关于书灯" leading={<CircleHelp size={21} color={palette.ink2} accessible={false} />} onPress={() => router.push("/about")} />
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  );
}
function createStyles(p: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: p.paper },
    content: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 40, width: "100%", maxWidth: 760, alignSelf: "center" },
    value: { fontSize: 14, lineHeight: 22, color: p.ink2, flexShrink: 1 },
    status: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "46%" },
  });
}
