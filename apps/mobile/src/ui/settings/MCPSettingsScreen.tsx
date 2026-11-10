import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  loadMCPServers,
  newMCPServer,
  type MCPServer,
} from "../../platform/mcp";
import { MCPServerEditor } from "./MCPServerEditor";
import {
  SettingsAction,
  SettingsHeader,
  SettingsRow,
  SettingsSection,
} from "./SettingsParts";
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
  const [servers, setServers] = useState<readonly MCPServer[] | null>(null);
  const [editing, setEditing] = useState<{
    server: MCPServer;
    isNew: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const values = await loadMCPServers();
      if (mounted.current && generation.current === request) setServers(values);
    } catch (cause) {
      if (mounted.current && generation.current === request)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && generation.current === request) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    setEditing(null);
    setServers(null);
    void refresh();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [refresh, serverId]);
  const deepLinkedServer = serverId
    ? servers?.find((item) => item.id === serverId)
    : undefined;
  const editor =
    editing ??
    (deepLinkedServer ? { server: deepLinkedServer, isNew: false } : null);
  if (editor)
    return (
      <MCPServerEditor
        key={editor.server.id}
        initial={editor.server}
        isNew={editor.isNew}
        onClose={serverId ? onBack : () => setEditing(null)}
        onChanged={() => {
          void refresh();
        }}
      />
    );
  const notice =
    error ||
    (serverId && !loading && servers
      ? "找不到这个外部工具，请返回后重试。"
      : "");
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: p.paper }}
      edges={["top", "left", "right"]}
    >
      <SettingsHeader
        title="外部工具"
        onBack={onBack}
        actions={
          !serverId ? (
            <SettingsAction
              title="添加"
              disabled={loading || !servers || !!error}
              onPress={() =>
                setEditing({ server: newMCPServer(), isNew: true })
              }
            />
          ) : undefined
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: 40,
          width: "100%",
          maxWidth: 760,
          alignSelf: "center",
        }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={p.lampInk} style={{ marginTop: 24 }} />
        ) : null}
        {notice ? (
          <SettingsSection>
            <SettingsRow
              title={notice}
              detail="点按重试，已有配置未覆盖"
              danger
              onPress={() => {
                void refresh();
              }}
            />
          </SettingsSection>
        ) : null}
        {!serverId && servers ? (
          <SettingsSection
            title="MCP 服务"
            first
            footer="外部工具默认关闭；只允许已授权的工具，首次调用前仍需确认。"
          >
            {servers.length ? (
              servers.map((server) => (
                <SettingsRow
                  key={server.id}
                  title={server.name}
                  detail={
                    (server.enabled ? "已启用" : "未启用") +
                    " · " +
                    new URL(server.endpoint).host +
                    " · " +
                    server.allowedTools.length +
                    " 个工具"
                  }
                  onPress={() => setEditing({ server, isNew: false })}
                />
              ))
            ) : (
              <SettingsRow title="尚未添加外部工具" detail="书内问答无需配置" />
            )}
          </SettingsSection>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
