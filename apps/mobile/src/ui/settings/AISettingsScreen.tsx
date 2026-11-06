import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { loadAIServiceCatalog, selectAIService } from "../../platform/aiConfig";
import type { AICatalog } from "../../platform/settings/aiCatalog";
import { aiConsentScope } from "../../platform/settings/aiCatalog";
import {
  getSemanticModelState,
  installSemanticModel,
  removeSemanticModel,
  type SemanticProgress,
} from "../../platform/semanticModel";
import { useAISendingConsent } from "./useAISendingConsent";
import { BookNotice } from "../components/BookNotice";
import {
  SettingsAction,
  SettingsHeader,
  SettingsRow,
  SettingsSection,
  showSettingsChoices,
} from "./SettingsParts";
import { usePalette } from "../theme";
import {
  cancelSemanticPreparation,
  prepareExistingBooks,
} from "../../platform/settings/semanticPreparation";

interface AISettingsScreenProps {
  readonly onBack: () => void;
  readonly onEditService: (serviceId: string) => void;
  readonly onMCPSettings: () => void;
  readonly onSendingDetails: () => void;
  readonly onAssistantSettings?: () => void;
}
type SemanticNotice = {
  readonly id: number;
  readonly kind: "downloaded" | "remove" | "remove-failed";
};

/** Shared content; the owning navigation stack supplies its destinations. */
export function AISettingsScreen({
  onBack,
  onEditService,
  onMCPSettings,
  onSendingDetails,
  onAssistantSettings,
}: AISettingsScreenProps) {
  const p = usePalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const { confirmAISending, sendingConsent } = useAISendingConsent();
  const [catalog, setCatalog] = useState<AICatalog | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [progress, setProgress] = useState<SemanticProgress | null>(null);
  const [semanticError, setSemanticError] = useState("");
  const [semanticNotice, setSemanticNotice] = useState<SemanticNotice | null>(
    null,
  );
  const activeSemanticNotice = useRef<SemanticNotice | null>(null);
  const noticeSequence = useRef(0);
  const task = useRef<AbortController | null>(null);
  const semanticGeneration = useRef(0);
  const removingSemantic = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const generation = semanticGeneration.current;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      loadAIServiceCatalog(),
      getSemanticModelState(),
    ]);
    if (!mounted.current) return;
    const [ai, model] = results;
    if (ai.status === "fulfilled") setCatalog(ai.value);
    else {
      setCatalog(null);
      setError(
        ai.reason instanceof Error
          ? ai.reason.message
          : "AI 配置读取失败；已有配置未覆盖。",
      );
    }
    if (
      model.status === "fulfilled" &&
      semanticGeneration.current === generation &&
      !task.current &&
      !removingSemantic.current
    )
      setInstalled(model.value.installed);
    setLoading(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    setSemanticNotice(null);
    setProgress(null);
    return () => {
      mounted.current = false;
      semanticGeneration.current++;
      activeSemanticNotice.current = null;
      task.current?.abort();
    };
  }, [refresh]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  const showSemanticNotice = (kind: SemanticNotice["kind"]) => {
    if (!mounted.current) return;
    const next = { id: ++noticeSequence.current, kind };
    activeSemanticNotice.current = next;
    setSemanticNotice(next);
  };
  const dismissSemanticNotice = (notice: SemanticNotice) => {
    if (!mounted.current || activeSemanticNotice.current !== notice)
      return false;
    activeSemanticNotice.current = null;
    setSemanticNotice(null);
    return true;
  };
  const download = async () => {
    if (
      !mounted.current ||
      task.current ||
      removingSemantic.current ||
      activeSemanticNotice.current
    )
      return;
    const controller = new AbortController();
    task.current = controller;
    const generation = ++semanticGeneration.current;
    const current = () =>
      mounted.current &&
      semanticGeneration.current === generation &&
      task.current === controller &&
      !controller.signal.aborted;
    setSemanticError("");
    setProgress({ stage: "download", fraction: 0 });
    try {
      await installSemanticModel({
        signal: controller.signal,
        onProgress: (value) => {
          if (current()) setProgress(value);
        },
      });
      if (!current()) return;
      setInstalled(true);
      showSemanticNotice("downloaded");
      prepareExistingBooks();
    } catch (cause) {
      if (current() && !(cause instanceof Error && cause.name === "AbortError"))
        setSemanticError(
          cause instanceof Error ? cause.message : String(cause),
        );
    } finally {
      if (task.current === controller) task.current = null;
      if (mounted.current && semanticGeneration.current === generation)
        setProgress(null);
    }
  };
  const removeInstalledSemantic = async () => {
    if (!mounted.current || removingSemantic.current) return;
    removingSemantic.current = true;
    ++semanticGeneration.current;
    try {
      await cancelSemanticPreparation();
      await removeSemanticModel();
      if (mounted.current) {
        setInstalled(false);
        setSemanticError("");
      }
    } catch {
      showSemanticNotice("remove-failed");
    } finally {
      removingSemantic.current = false;
    }
  };
  const semanticAction = () => {
    if (loading) return;
    if (task.current) {
      if (!task.current.signal.aborted) {
        semanticGeneration.current++;
        task.current.abort();
        setSemanticError("");
        setProgress(null);
      }
      return;
    }
    if (removingSemantic.current || activeSemanticNotice.current) return;
    if (!installed) {
      void download();
      return;
    }
    showSemanticNotice("remove");
  };
  const switchService = () => {
    if (!catalog?.services.length) return;
    showSettingsChoices("切换 AI 服务", [
      ...catalog.services.map((service) => ({
        title:
          service.name + (service.id === catalog.selectedId ? " · 使用中" : ""),
        onPress: () => {
          void (async () => {
            if (
              service.consentScope !== aiConsentScope(service) &&
              !(await confirmAISending(service, "同意并使用已保存服务"))
            )
              return;
            if (!mounted.current) return;
            await selectAIService(service.id, true);
            await refresh();
          })().catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        },
      })),
    ]);
  };
  const ordered = catalog
    ? [...catalog.services].sort(
        (a, b) =>
          Number(b.id === catalog.selectedId) -
          Number(a.id === catalog.selectedId),
      )
    : [];
  const stageText =
    progress?.stage === "extract"
      ? "正在解压"
      : progress?.stage === "verify"
        ? "正在校验"
        : "正在下载";
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <SettingsHeader
        title="AI 与助手"
        centered={false}
        onBack={onBack}
        actions={
          <>
            <SettingsAction
              title="切换"
              disabled={!catalog?.services.length || loading}
              onPress={switchService}
            />
            <SettingsAction
              title="添加"
              disabled={!catalog || loading}
              onPress={() => onEditService("new")}
            />
          </>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loading && !catalog ? (
          <ActivityIndicator color={p.lampInk} style={styles.spinner} />
        ) : null}
        {error ? (
          <SettingsSection>
            <SettingsRow
              title={error}
              detail="点此重试；已有配置未覆盖，阅读仍可使用。"
              danger
              onPress={() => void refresh()}
            />
          </SettingsSection>
        ) : null}
        <SettingsSection
          title="模型服务"
          first
          footer="API Key 仅保存在本机 Keychain；点按服务可编辑或检查连接。"
        >
          {ordered.length ? (
            ordered.map((service) => (
              <SettingsRow
                key={service.id}
                title={service.name}
                detail={
                  "模型：" +
                  service.model +
                  (service.id === catalog?.selectedId ? " · 使用中" : "") +
                  (service.consentScope !== aiConsentScope(service)
                    ? " · 待确认发送说明"
                    : "")
                }
                selected={service.id === catalog?.selectedId}
                onPress={() => onEditService(service.id)}
              />
            ))
          ) : (
            <SettingsRow title="尚未配置 AI 服务，仍可正常阅读。" />
          )}
        </SettingsSection>
        {onAssistantSettings ? (
          <SettingsSection title="阅读助手">
            <SettingsRow
              title="自定义指令"
              detail="人设、语气与回答偏好"
              onPress={onAssistantSettings}
            />
          </SettingsSection>
        ) : null}
        <SettingsSection
          title="本地语义资料"
          footer="用于书内语义检索，一次下载约 81MB。"
        >
          <SettingsRow
            title="语义资料"
            testID="ai-semantic"
            accessibilityValue={
              progress
                ? "下载中 " + Math.round(progress.fraction * 100) + "%"
                : installed
                  ? "已下载"
                  : semanticError
                    ? "下载失败"
                    : "未下载"
            }
            detail={
              progress
                ? stageText +
                  " " +
                  Math.floor(progress.fraction * 100) +
                  "% · 点按取消"
                : installed
                  ? "已下载 · 约 81MB"
                  : semanticError || "未下载 · 约 81MB"
            }
            leading={
              <SymbolView
                name={installed ? "checkmark.circle.fill" : "arrow.down.circle"}
                size={26}
                tintColor={p.lampInk}
              />
            }
            onPress={semanticAction}
            trailing={progress ? <ActivityIndicator color={p.lampInk} /> : null}
          />
        </SettingsSection>
        {semanticError ? (
          <Text style={styles.error}>{semanticError}</Text>
        ) : null}
        <SettingsSection title="其他">
          <SettingsRow
            title="外部工具"
            detail="MCP 服务与工具授权"
            onPress={onMCPSettings}
          />
          <SettingsRow
            title="AI 发送说明"
            detail="问题与相关原文会发送到所选服务"
            onPress={onSendingDetails}
          />
        </SettingsSection>
      </ScrollView>
      {sendingConsent}
      {semanticNotice ? (
        <BookNotice
          key={semanticNotice.id}
          title={
            semanticNotice.kind === "downloaded"
              ? "语义资料已下载"
              : semanticNotice.kind === "remove"
                ? "删除语义资料？"
                : "删除未完成"
          }
          message={
            semanticNotice.kind === "downloaded"
              ? "语义资料会在后台准备；阅读、原文搜索和笔记不受影响。"
              : semanticNotice.kind === "remove"
                ? "删除后书内 AI 语义检索暂不可用；阅读、原文搜索和笔记不受影响。"
                : "语义资料仍保留；请稍后重试。"
          }
          actions={
            semanticNotice.kind === "remove"
              ? [
                  {
                    title: "取消",
                    style: "cancel",
                    onPress: () => {
                      dismissSemanticNotice(semanticNotice);
                    },
                  },
                  {
                    title: "删除",
                    style: "destructive",
                    onPress: () => {
                      if (dismissSemanticNotice(semanticNotice))
                        void removeInstalledSemantic();
                    },
                  },
                ]
              : [
                  {
                    title:
                      semanticNotice.kind === "downloaded" ? "完成" : "知道了",
                    onPress: () => {
                      dismissSemanticNotice(semanticNotice);
                    },
                  },
                ]
          }
        />
      ) : null}
    </SafeAreaView>
  );
}
function makeStyles(p: ReturnType<typeof usePalette>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.paper },
    content: { paddingHorizontal: 16, paddingBottom: 32 },
    spinner: { marginTop: 24 },
    error: { color: p.error, fontSize: 12, lineHeight: 18, margin: 16 },
  });
}
