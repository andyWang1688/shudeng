import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  loadAIServiceCatalog,
  type AIService,
} from "../../../src/platform/aiConfig";
import { AIServiceDraftProvider } from "../../../src/ui/settings/AIServiceDraft";
import {
  AIServiceNavigationProvider,
  useAIServiceNavigation,
} from "../../../src/ui/settings/AIServiceNavigation";
import {
  SettingsHeader,
  SettingsRow,
  SettingsSection,
} from "../../../src/ui/settings/SettingsParts";
import { usePalette } from "../../../src/ui/theme";
import { mcpToolConsentScreenLayout } from "../../../src/ui/settings/MCPToolConsentScreenHost";

export const unstable_settings = { anchor: "index" };

export default function AIServiceLayout() {
  const { serviceId = "new", returnTo } = useLocalSearchParams<{
    serviceId?: string;
    returnTo?: string;
  }>();
  return (
    <AIServiceNavigationProvider returnTo={returnTo}>
      <AIServiceStack serviceId={serviceId} />
    </AIServiceNavigationProvider>
  );
}

function AIServiceStack({ serviceId }: { readonly serviceId: string }) {
  const { closeEditor } = useAIServiceNavigation();
  const p = usePalette();
  const [loaded, setLoaded] = useState<{
    service: AIService | null;
    selected: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadAIServiceCatalog()
      .then((catalog) => {
        if (!active) return;
        const service =
          catalog.services.find((item) => item.id === serviceId) ?? null;
        if (serviceId !== "new" && !service)
          throw new Error("找不到这个服务，请返回后重试。");
        setLoaded({ service, selected: service?.id === catalog.selectedId });
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [serviceId]);
  if (!loaded)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: p.paper }}>
        <SettingsHeader title="AI 服务" onBack={closeEditor} />
        {error ? (
          <View style={styles.content}>
            <SettingsSection>
              <SettingsRow title={error} danger />
            </SettingsSection>
          </View>
        ) : (
          <ActivityIndicator color={p.lampInk} />
        )}
      </SafeAreaView>
    );
  return (
    <AIServiceDraftProvider service={loaded.service} selected={loaded.selected}>
      <Stack
        screenLayout={mcpToolConsentScreenLayout}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: p.paper },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="advanced" />
      </Stack>
    </AIServiceDraftProvider>
  );
}
const styles = StyleSheet.create({ content: { paddingHorizontal: 16 } });
