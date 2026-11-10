import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadAIServiceCatalog, removeAIService, selectAIService, type AIService } from "../../platform/aiConfig";
import { aiConsentScope, type AICatalog } from "../../platform/settings/aiCatalog";
import { useAISendingConsent } from "./useAISendingConsent";
import { BookNotice } from "../components/BookNotice";
import { SettingsHeader, SettingsRow, SettingsSection } from "./SettingsParts";
import { ServiceList } from "./ServiceList";
import { usePalette } from "../theme";

interface AISettingsScreenProps {
  readonly onBack: () => void;
  readonly onEditService: (serviceId: string) => void;
  // Compatibility routes remain available to existing callers; they have no visible entry here.
  readonly onMCPSettings?: () => void;
  readonly onSendingDetails?: () => void;
  readonly onAssistantSettings?: () => void;
}
type Operation = { readonly lease: number; phase: "confirm" | "write" };
type Removal = { readonly service: AIService; readonly operation: Operation };

/** Selecting a service only changes future requests. Active Agent runs own their snapshot. */
export function AISettingsScreen({ onBack, onEditService }: AISettingsScreenProps) {
  const p = usePalette();
  const { confirmAISending, sendingConsent } = useAISendingConsent();
  const [catalog, setCatalog] = useState<AICatalog | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const mounted = useRef(false);
  const focused = useRef(false);
  const focusLease = useRef(0);
  const refreshGeneration = useRef(0);
  const operation = useRef<Operation | null>(null);
  const activeRemoval = useRef<Removal | null>(null);

  const refresh = useCallback(async () => {
    if (!mounted.current || !focused.current) return;
    const generation = ++refreshGeneration.current;
    const current = () => mounted.current && focused.current && generation === refreshGeneration.current;
    setLoading(true);
    setError("");
    try {
      const value = await loadAIServiceCatalog();
      if (current()) setCatalog(value);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "AI 服务读取失败，请重试。");
    } finally {
      if (current()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      focused.current = false;
      ++focusLease.current;
      ++refreshGeneration.current;
      activeRemoval.current = null;
    };
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    ++focusLease.current;
    void refresh();
    return () => {
      focused.current = false;
      ++focusLease.current;
      ++refreshGeneration.current;
      if (activeRemoval.current) {
        const pending = activeRemoval.current;
        activeRemoval.current = null;
        setRemoval(null);
        if (operation.current === pending.operation && pending.operation.phase === "confirm") {
          operation.current = null;
          setBusy(false);
        }
      }
    };
  }, [refresh]));

  const isCurrent = (pending: Operation) => mounted.current && focused.current && pending.lease === focusLease.current && operation.current === pending;
  const canPublishWrite = (pending: Operation) => mounted.current && focused.current && operation.current === pending;
  const begin = (): Operation | null => {
    if (!mounted.current || !focused.current || loading || error || !catalog || operation.current) return null;
    const pending: Operation = { lease: focusLease.current, phase: "confirm" };
    operation.current = pending;
    setBusy(true);
    return pending;
  };
  const finish = (pending: Operation) => {
    if (operation.current !== pending) return;
    operation.current = null;
    if (mounted.current) setBusy(false);
  };
  const select = async (service: AIService) => {
    if (service.id === catalog?.selectedId && service.consentScope === aiConsentScope(service)) return;
    const pending = begin();
    if (!pending) return;
    try {
      if (service.consentScope !== aiConsentScope(service) && !(await confirmAISending(service, "同意并使用已保存服务"))) return;
      if (!isCurrent(pending)) return;
      pending.phase = "write";
      await selectAIService(service.id, true);
      if (canPublishWrite(pending)) await refresh();
    } catch (cause) {
      if (pending.phase === "write" ? canPublishWrite(pending) : isCurrent(pending)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finish(pending);
    }
  };
  const requestRemoval = (service: AIService) => {
    const pending = begin();
    if (!pending) return;
    const next = { service, operation: pending };
    activeRemoval.current = next;
    setRemoval(next);
  };
  const dismissRemoval = (request: Removal) => {
    if (activeRemoval.current !== request || !isCurrent(request.operation)) return false;
    activeRemoval.current = null;
    setRemoval(null);
    return true;
  };
  const remove = async (request: Removal) => {
    if (!dismissRemoval(request)) return;
    const pending = request.operation;
    pending.phase = "write";
    try {
      await removeAIService(request.service.id);
      if (canPublishWrite(pending)) await refresh();
    } catch (cause) {
      if (canPublishWrite(pending)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finish(pending);
    }
  };
  const edit = (id: string) => {
    if (mounted.current && focused.current && !loading && !error && catalog && !operation.current) onEditService(id);
  };
  const notice = busy
    ? "正在处理…"
    : catalog?.selectedId
      ? "轻点选择服务，点右侧按钮编辑。切换后下一次提问生效。"
      : "尚未选择服务。轻点已保存服务即可使用，或添加新服务。";
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: p.paper }]} edges={["top", "left", "right"]}>
      <SettingsHeader title="AI 服务" onBack={onBack} centered={false} />
      {loading ? <ActivityIndicator accessibilityLabel="正在读取 AI 服务" color={p.lampInk} style={styles.spinner} /> : null}
      {error ? (
        <View style={styles.error}>
          <SettingsSection first><SettingsRow title={error} detail="点此重试；已保存服务和历史对话会保留。" danger onPress={() => { if (!operation.current) void refresh(); }} /></SettingsSection>
        </View>
      ) : null}
      <ServiceList services={catalog?.services ?? []} selectedId={catalog?.selectedId ?? null} notice={notice}
        disabled={!catalog || loading || busy || !!error} onSelect={(service) => void select(service)} onEdit={(service) => edit(service.id)}
        onAdd={() => edit("new")} onRemove={requestRemoval} />
      {sendingConsent}
      {removal ? <BookNotice title="删除 AI 服务？"
        message={"将删除“" + removal.service.name + "”的连接配置。" + (removal.service.id === catalog?.selectedId ? "删除后需重新选择服务。" : "") + "历史对话会保留，正在生成的回答不受影响。"}
        actions={[
          { title: "取消", style: "cancel", onPress: () => { if (dismissRemoval(removal)) finish(removal.operation); } },
          { title: "删除", style: "destructive", onPress: () => void remove(removal) },
        ]} /> : null}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  spinner: { marginTop: 12 },
  error: { paddingHorizontal: 24, width: "100%", maxWidth: 760, alignSelf: "center" },
});
