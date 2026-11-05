import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  discoverMCPTools,
  removeMCPServer,
  saveMCPServer,
  type MCPServer,
} from "../../platform/mcp";
import { retainedMCPToolPermissions } from "../../platform/settings/mcpAuthorization";
import { parseMCPServer } from "../../platform/settings/mcpPolicy";
import { usePalette } from "../theme";
import {
  SettingsAction,
  SettingsHeader,
  SettingsRow,
  SettingsSection,
  showSettingsChoices,
} from "./SettingsParts";
export function MCPServerEditor({
  initial,
  isNew,
  onClose,
  onChanged,
}: {
  readonly initial: MCPServer;
  readonly isNew: boolean;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const p = usePalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [server, setServer] = useState(initial);
  const [header, setHeader] = useState(
    Object.entries(initial.headers)
      .map(([name, value]) => name + ": " + value)
      .join("\n"),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const task = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      task.current?.abort();
    };
  }, []);
  const fail = (error: unknown) => {
    if (mounted.current)
      setStatus(error instanceof Error ? error.message : String(error));
  };
  const draft = (): MCPServer => {
    const headers: Record<string, string> = {};
    for (const line of header.split("\n").filter((item) => item.trim())) {
      const colon = line.indexOf(":");
      if (colon <= 0) throw new Error("Header 格式需为 名称: 内容。");
      headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    return { ...server, headers };
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await saveMCPServer(draft());
      if (mounted.current) setServer(saved);
      onChanged();
      if (isNew) onClose();
      else setStatus("已保存。");
    } catch (error) {
      fail(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const discover = async () => {
    if (busy) return;
    setBusy(true);
    task.current = new AbortController();
    setStatus("正在连接外部工具…");
    try {
      // Reading a disabled draft must not implicitly persist it.
      const candidate = parseMCPServer(draft());
      if (!candidate.enabled) throw new Error("请先启用这个外部工具，再读取工具。");
      const value = await saveMCPServer(candidate);
      if (mounted.current) setServer(value);
      const tools = await discoverMCPTools(value, task.current.signal);
      const next = await saveMCPServer({
        ...value,
        tools,
        allowedTools: retainedMCPToolPermissions(value, tools),
      });
      if (mounted.current) {
        setServer(next);
        const revoked = value.allowedTools.length - next.allowedTools.length;
        setStatus(
          tools.length
            ? "已读取 " +
                tools.length +
                " 个工具。" +
                (revoked > 0
                  ? "其中 " +
                    revoked +
                    " 个原授权工具已变更或移除，开关已关闭；请检查定义后重新允许。"
                  : "")
            : "这个服务没有提供工具。",
        );
        onChanged();
      }
    } catch (error) {
      fail(error);
    } finally {
      if (mounted.current) setBusy(false);
      task.current = null;
    }
  };
  const toggleTool = async (name: string, enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = {
        ...draft(),
        allowedTools: enabled
          ? [...new Set([...server.allowedTools, name])]
          : server.allowedTools.filter((value) => value !== name),
      };
      const saved = await saveMCPServer(next);
      if (mounted.current) setServer(saved);
      onChanged();
    } catch (error) {
      fail(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "left", "right", "bottom"]}
    >
      <SettingsHeader
        title={isNew ? "添加外部工具" : "外部工具"}
        onBack={onClose}
        actions={
          <SettingsAction
            title="保存"
            disabled={busy}
            onPress={() => void save()}
          />
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <SettingsSection
          title="连接"
          footer="只支持 HTTPS；本机测试可用 HTTP。自定义 Header 仅保存在本机，用于这个服务鉴权。不会发送 AI Key 或书库。"
        >
          <View style={styles.field}>
            <Text style={styles.label}>名称</Text>
            <TextInput
              accessibilityLabel="外部工具名称"
              value={server.name}
              onChangeText={(name) => setServer({ ...server, name })}
              style={styles.input}
              editable={!busy}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>地址</Text>
            <TextInput
              accessibilityLabel="外部工具地址"
              value={server.endpoint}
              onChangeText={(endpoint) =>
                setServer({ ...server, endpoint, tools: [], allowedTools: [] })
              }
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
              editable={!busy}
            />
          </View>
          <SettingsRow
            title="传输方式"
            detail={server.transport === "http" ? "HTTP" : "SSE 流式"}
            onPress={() =>
              showSettingsChoices("传输方式", [
                {
                  title: "HTTP",
                  onPress: () =>
                    setServer({
                      ...server,
                      transport: "http",
                      tools: [],
                      allowedTools: [],
                    }),
                },
                {
                  title: "SSE 流式",
                  onPress: () =>
                    setServer({
                      ...server,
                      transport: "sse",
                      tools: [],
                      allowedTools: [],
                    }),
                },
              ])
            }
          />
          <View style={styles.field}>
            <Text style={styles.label}>请求 Header</Text>
            <TextInput
              accessibilityLabel="请求 Header"
              value={header}
              onChangeText={setHeader}
              placeholder="可选，如 Authorization: Bearer …"
              placeholderTextColor={p.ink3}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
              editable={!busy}
            />
          </View>
          <SettingsRow
            title="启用外部工具"
            detail={server.enabled ? "已启用" : "默认关闭"}
            trailing={
              <Switch
                accessibilityLabel="启用外部工具"
                value={server.enabled}
                disabled={busy}
                onValueChange={(enabled) => setServer({ ...server, enabled })}
                trackColor={{ true: p.lampInk }}
              />
            }
          />
        </SettingsSection>
        <SettingsSection
          title="可用工具"
          footer="只有打开开关的工具才会交给 AI。首次调用前仍会请求确认。"
        >
          <SettingsRow
            title={busy ? "正在读取工具…" : "读取可用工具"}
            onPress={busy ? undefined : () => void discover()}
          />
          {busy ? (
            <SettingsRow
              title="取消连接"
              onPress={() => task.current?.abort()}
            />
          ) : null}
          {server.tools.map((tool) => (
            <SettingsRow
              key={tool.name}
              title={tool.name}
              detail={
                (tool.readOnly ? "只读" : "可写，请谨慎授权") +
                (tool.description ? " · " + tool.description : "")
              }
              danger={!tool.readOnly}
              trailing={
                <Switch
                  accessibilityLabel={"允许 " + tool.name}
                  value={server.allowedTools.includes(tool.name)}
                  disabled={busy}
                  onValueChange={(allowed) => {
                    void toggleTool(tool.name, allowed);
                  }}
                  trackColor={{ true: p.lampInk }}
                />
              }
            />
          ))}
        </SettingsSection>
        {status ? (
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {status}
          </Text>
        ) : null}
        {!isNew ? (
          <SettingsSection title="管理">
            <SettingsRow
              title="删除这个外部工具"
              danger
              onPress={() =>
                Alert.alert("删除这个外部工具？", "书内问答不受影响。", [
                  { text: "取消", style: "cancel" },
                  {
                    text: "删除",
                    style: "destructive",
                    onPress: () => {
                      void removeMCPServer(server.id)
                        .then(() => {
                          onChanged();
                          onClose();
                        })
                        .catch(fail);
                    },
                  },
                ])
              }
            />
          </SettingsSection>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
function makeStyles(p: ReturnType<typeof usePalette>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.paper },
    content: { paddingHorizontal: 16, paddingBottom: 32 },
    field: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      gap: 12,
    },
    label: { width: 82, color: p.ink3, fontSize: 12 },
    input: { minHeight: 52, flex: 1, fontSize: 15, color: p.ink },
    status: { margin: 16, color: p.ink2, fontSize: 13, lineHeight: 20 },
  });
}
