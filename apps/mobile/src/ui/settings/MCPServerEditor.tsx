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
  const [discovering, setDiscovering] = useState(false);
  const [commitPhase, setCommitPhase] = useState<"connection" | "tools" | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const inFlight = useRef(false);
  const task = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const closing = useRef(false);
  const discoveryCommit = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      task.current?.abort();
    };
  }, []);
  const active = () => mounted.current && !closing.current;
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    task.current?.abort();
    onClose();
  };
  const editable = () => active() && !inFlight.current;
  const begin = () => {
    if (!editable()) return false;
    inFlight.current = true;
    setBusy(true);
    return true;
  };
  const finish = () => {
    inFlight.current = false;
    if (active()) setBusy(false);
  };
  const fail = (error: unknown) => {
    if (active())
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
    if (!begin()) return;
    try {
      const saved = await saveMCPServer(draft());
      onChanged();
      if (!active()) return;
      setServer(saved);
      if (isNew) close();
      else setStatus("已保存。");
    } catch (error) {
      fail(error);
    } finally {
      finish();
    }
  };
  const discover = async () => {
    if (!begin()) return;
    setDiscovering(true);
    const request = new AbortController();
    task.current = request;
    setStatus("正在连接外部工具…");
    try {
      // Reading a disabled draft must not implicitly persist it.
      const candidate = parseMCPServer(draft());
      if (!candidate.enabled)
        throw new Error("请先启用这个外部工具，再读取工具。");
      discoveryCommit.current = true;
      setCommitPhase("connection");
      setStatus("正在保存连接…");
      const value = await saveMCPServer(candidate);
      onChanged();
      if (!active()) return;
      setServer(value);
      discoveryCommit.current = false;
      setCommitPhase(null);
      if (request.signal.aborted) return;
      setStatus("正在连接外部工具…");
      const tools = await discoverMCPTools(value, request.signal);
      if (!active() || request.signal.aborted) return;
      // Persistence has no cancellation contract once queued. Keep both the
      // visible control and any retained cancel callback out of this phase.
      discoveryCommit.current = true;
      setCommitPhase("tools");
      setStatus("正在保存工具…");
      const next = await saveMCPServer({
        ...value,
        tools,
        allowedTools: retainedMCPToolPermissions(value, tools),
      });
      onChanged();
      if (active()) {
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
      }
    } catch (error) {
      if (discoveryCommit.current || !request.signal.aborted) fail(error);
    } finally {
      if (active()) {
        if (!discoveryCommit.current && request.signal.aborted)
          setStatus("连接已取消。");
        setDiscovering(false);
        setCommitPhase(null);
      }
      discoveryCommit.current = false;
      finish();
      task.current = null;
    }
  };
  const toggleTool = async (name: string, enabled: boolean) => {
    if (!begin()) return;
    try {
      const next = {
        ...draft(),
        allowedTools: enabled
          ? [...new Set([...server.allowedTools, name])]
          : server.allowedTools.filter((value) => value !== name),
      };
      const saved = await saveMCPServer(next);
      onChanged();
      if (!active()) return;
      setServer(saved);
    } catch (error) {
      fail(error);
    } finally {
      finish();
    }
  };
  const chooseTransport = () => {
    if (!editable()) return;
    showSettingsChoices(
      "传输方式",
      (["http", "sse"] as const).map((transport) => ({
        title: transport === "http" ? "HTTP" : "SSE 流式",
        onPress: () => {
          if (editable())
            setServer({ ...server, transport, tools: [], allowedTools: [] });
        },
      })),
    );
  };
  const remove = async () => {
    if (!begin()) return;
    try {
      await removeMCPServer(server.id);
      onChanged();
      if (!active()) return;
      close();
    } catch (error) {
      fail(error);
    } finally {
      finish();
    }
  };
  const confirmRemove = () => {
    if (!editable()) return;
    Alert.alert("删除这个外部工具？", "书内问答不受影响。", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => void remove() },
    ]);
  };
  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "left", "right", "bottom"]}
    >
      <SettingsHeader
        title={isNew ? "添加外部工具" : "外部工具"}
        onBack={close}
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
              onChangeText={(name) => {
                if (editable()) setServer({ ...server, name });
              }}
              style={styles.input}
              editable={!busy}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>地址</Text>
            <TextInput
              accessibilityLabel="外部工具地址"
              value={server.endpoint}
              onChangeText={(endpoint) => {
                if (editable())
                  setServer({
                    ...server,
                    endpoint,
                    tools: [],
                    allowedTools: [],
                  });
              }}
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
            disabled={busy}
            onPress={chooseTransport}
          />
          <View style={styles.field}>
            <Text style={styles.label}>请求 Header</Text>
            <TextInput
              accessibilityLabel="请求 Header"
              value={header}
              onChangeText={(value) => {
                if (editable()) setHeader(value);
              }}
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
                onValueChange={(enabled) => {
                  if (editable()) setServer({ ...server, enabled });
                }}
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
            title={
              commitPhase === "connection"
                ? "正在保存连接…"
                : commitPhase === "tools"
                  ? "正在保存工具…"
                  : discovering
                    ? "正在读取工具…"
                    : "读取可用工具"
            }
            disabled={busy}
            onPress={() => void discover()}
          />
          {discovering && !commitPhase ? (
            <SettingsRow
              title="取消连接"
              onPress={() => {
                if (!discoveryCommit.current) task.current?.abort();
              }}
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
              disabled={busy}
              onPress={confirmRemove}
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
    content: {
      paddingHorizontal: 24,
      paddingBottom: 40,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
    },
    field: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      gap: 12,
    },
    label: { width: 82, color: p.ink2, fontSize: 13, lineHeight: 20 },
    input: { minHeight: 52, flex: 1, fontSize: 17, color: p.ink },
    status: { margin: 16, color: p.ink2, fontSize: 13, lineHeight: 20 },
  });
}
