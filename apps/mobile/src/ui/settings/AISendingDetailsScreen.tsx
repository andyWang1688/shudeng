import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePalette } from "../theme";
import { AI_SENDING_DETAILS } from "./aiSendingDetails";
import { SettingsHeader } from "./SettingsParts";

/** A pushed, readable destination, like native AIPrivacyController(.sending). */
export function AISendingDetailsScreen({ onBack }: { readonly onBack: () => void }) {
  const p = usePalette();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: p.paper }]} edges={["top", "left", "right"]}>
      <SettingsHeader title="AI 服务发送说明" onBack={onBack} />
      <ScrollView testID="ai-sending-details" contentContainerStyle={styles.content}>
        <View style={[styles.group, { backgroundColor: p.surface }]}>
          {AI_SENDING_DETAILS.map((paragraph, index) => (
            <View key={paragraph.heading}>
              <View style={styles.row}>
                <Text accessibilityRole="header" style={[styles.heading, { color: p.ink }]}>{paragraph.heading}</Text>
                <Text style={[styles.body, { color: p.ink2 }]}>{paragraph.body}</Text>
              </View>
              {index < AI_SENDING_DETAILS.length - 1 ? <View style={[styles.separator, { backgroundColor: p.line }]} /> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  group: { borderRadius: 10, overflow: "hidden" },
  row: { paddingVertical: 11, paddingHorizontal: 20, gap: 8 },
  heading: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 20 },
});
