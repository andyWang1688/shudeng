import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import {
  getSemanticModelState,
  installSemanticModel,
  removeSemanticModel,
  type SemanticProgress,
} from "../../platform/semanticModel";
import { BookNotice } from "../components/BookNotice";
import {
  SettingsAction,
  SettingsHeader,
  SettingsRow,
  SettingsSection,
} from "./SettingsParts";
import { usePalette } from "../theme";
import {
  cancelSemanticPreparation,
  observeSemanticPreparation,
  prepareExistingBooks,
  type SemanticPreparationState,
} from "../../platform/settings/semanticPreparation";

type SemanticNotice = {
  readonly id: number;
  readonly kind: "downloaded" | "remove" | "remove-failed";
};

/** Shared content; the owning navigation stack supplies its destinations. */
export function SemanticSettingsScreen({ onBack }: { readonly onBack: () => void }) {
  const p = usePalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [progress, setProgress] = useState<SemanticProgress | null>(null);
  const [semanticError, setSemanticError] = useState("");
  const [preparation, setPreparation] = useState<SemanticPreparationState | null>(null);
  const [removing, setRemoving] = useState(false);
  const [cancellingPreparation, setCancellingPreparation] = useState(false);
  const cancelling = useRef(false);
  const [semanticNotice, setSemanticNotice] = useState<SemanticNotice | null>(
    null,
  );
  const activeSemanticNotice = useRef<SemanticNotice | null>(null);
  const noticeSequence = useRef(0);
  const task = useRef<AbortController | null>(null);
  const semanticGeneration = useRef(0);
  const removingSemantic = useRef(false);
  const mounted = useRef(true);
  const focused = useRef(false);
  const refreshGeneration = useRef(0);
  const refresh = useCallback(async () => {
    if (!mounted.current || !focused.current) return;
    const request = ++refreshGeneration.current;
    const current = () =>
      mounted.current &&
      focused.current &&
      request === refreshGeneration.current;
    const generation = semanticGeneration.current;
    setLoading(true);
    setError("");
    try {
      const model = await getSemanticModelState();
      if (!current()) return;
      if (semanticGeneration.current === generation && !task.current && !removingSemantic.current)
        setInstalled(model.installed);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "资料状态读取失败，请重试。");
    }
    if (!current()) return;
    setLoading(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    setSemanticNotice(null);
    setProgress(null);
    return () => {
      mounted.current = false;
      ++refreshGeneration.current;
      semanticGeneration.current++;
      activeSemanticNotice.current = null;
      task.current?.abort();
    };
  }, [refresh]);
  useEffect(() => observeSemanticPreparation((value) => {
    if (mounted.current) setPreparation(value);
  }), []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void refresh();
      return () => {
        focused.current = false;
        ++refreshGeneration.current;
        activeSemanticNotice.current = null;
        setSemanticNotice(null);
      };
    }, [refresh]),
  );
  const showSemanticNotice = (kind: SemanticNotice["kind"]) => {
    if (!mounted.current || !focused.current) return;
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
    setRemoving(true);
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
      if (mounted.current) setRemoving(false);
    }
  };
  const semanticAction = () => {
    if (loading || error || cancelling.current || !focused.current || !mounted.current) return;
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
  const cancelPreparation = async () => {
    if (cancelling.current || removingSemantic.current || !mounted.current || !focused.current) return;
    cancelling.current = true;
    setCancellingPreparation(true);
    try {
      await cancelSemanticPreparation();
    } catch (cause) {
      if (mounted.current) setSemanticError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      cancelling.current = false;
      if (mounted.current) setCancellingPreparation(false);
    }
  };
  const stageText =
    progress?.stage === "extract"
      ? "正在解压"
      : progress?.stage === "verify"
        ? "正在校验"
        : "正在下载";
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <SettingsHeader title="离线语义资料" onBack={onBack} centered={false} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={p.lampInk} style={styles.spinner} />
        ) : null}
        {error ? (
          <SettingsSection>
            <SettingsRow
              title={error}
              detail="点此重新读取；阅读与原文搜索仍可使用。"
              danger
              onPress={() => void refresh()}
            />
          </SettingsSection>
        ) : null}
        <SettingsSection
          title="检索资料"
          first
          footer="用于书内语义检索；阅读与原文搜索不依赖此资料。"
        >
          <SettingsRow
            title="离线语义资料"
            testID="ai-semantic"
            disabled={loading || !!error || removing || cancellingPreparation}
            accessibilityValue={
              removing
                ? "正在删除…"
                : progress
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
        <Pressable accessibilityRole="button" disabled={loading || !!error || removing || cancellingPreparation}
          accessibilityState={{ disabled: loading || !!error || removing || cancellingPreparation }}
          onPress={semanticAction} style={({ pressed }) => [styles.primary, { backgroundColor: installed ? p.surface : p.lampInk, opacity: loading || removing || cancellingPreparation ? 0.45 : pressed ? 0.7 : 1 }]}>
          <Text style={[styles.primaryText, { color: installed ? p.error : p.paper }]}>{removing ? "正在删除…" : progress ? "取消下载" : installed ? "删除资料" : semanticError ? "重试下载" : "下载资料"}</Text>
        </Pressable>
        {semanticError ? (
          <Text style={styles.error}>{semanticError}</Text>
        ) : null}
        <Text style={styles.hint}>下载完成后，各本书还需准备自己的检索索引。</Text>
        {installed ? (
          <SettingsSection title="书籍检索准备">
            <SettingsRow
              title={preparation?.running ? "正在准备检索索引" : preparation?.failed ? "部分书籍准备失败" : preparation?.cancelled ? "准备已取消" : preparation?.detail ? "检索准备状态" : "准备书籍检索"}
              detail={preparation?.running ? `${preparation.completed} / ${preparation.total} 本 · ${preparation.detail}` : preparation?.detail || "为本机书籍准备语义检索索引。"}
            />
            <SettingsAction
              title={preparation?.running ? (cancellingPreparation ? "正在取消…" : "取消准备") : preparation?.failed || preparation?.cancelled ? "重试准备" : "准备书籍"}
              disabled={removing || cancellingPreparation || !!progress}
              onPress={() => {
                if (!mounted.current || !focused.current || removingSemantic.current || cancelling.current) return;
                if (preparation?.running) void cancelPreparation();
                else {
                  setSemanticError("");
                  prepareExistingBooks();
                }
              }}
            />
          </SettingsSection>
        ) : null}
      </ScrollView>
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
    content: {
      paddingHorizontal: 24,
      paddingBottom: 40,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
    },
    spinner: { marginTop: 24 },
    primary: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 26, padding: 12 },
    primaryText: { fontSize: 17, fontWeight: "600" },
    hint: { color: p.ink2, fontSize: 14, lineHeight: 23, marginTop: 12, marginHorizontal: 4 },
    error: { color: p.error, fontSize: 12, lineHeight: 18, margin: 16 },
  });
}
