import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  loadMCPServers,
  newMCPServer,
  type MCPServer,
} from "../../platform/mcp";
import { MCPServerEditor } from "./MCPServerEditor";
import { SettingsHeader, SettingsRow, SettingsSection } from "./SettingsParts";
import { usePalette } from "../theme";
interface MCPSettingsScreenProps {
  readonly serverId?: string | undefined;
  readonly onBack: () => void;
}

export function MCPSettingsScreen({
  serverId,
  onBack,
}: MCPSettingsScreenProps) {
  const p = usePalette();
  const [server, setServer] = useState<MCPServer | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!serverId) {
      setServer(newMCPServer());
      return;
    }
    void loadMCPServers()
      .then((servers) => {
        if (!active) return;
        const value = servers.find((item) => item.id === serverId);
        if (!value) throw new Error("找不到这个外部工具，请返回后重试。");
        setServer(value);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [serverId]);
  if (!server)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: p.paper }}>
        <SettingsHeader title="外部工具" onBack={onBack} />
        {error ? (
          <View style={{ paddingHorizontal: 16 }}>
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
    <MCPServerEditor
      initial={server}
      isNew={!serverId}
      onClose={onBack}
      onChanged={() => undefined}
    />
  );
}
