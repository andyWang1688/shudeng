import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ASSISTANT_INSTRUCTIONS_MAX_LENGTH,
  DEFAULT_ASSISTANT_PREFERENCES,
  loadAssistantPreferences,
  saveAssistantPreferences,
  type AssistantPreferences,
} from "../../platform/assistantPreferences";
import {
  SettingsAction,
  SettingsHeader,
  SettingsRow,
  SettingsSection,
} from "./SettingsParts";
import { usePalette } from "../theme";

// Preserve unsaved edits when either navigation stack removes the screen, including swipe-back.
// Only saveAssistantPreferences commits settings; this draft lasts for the current app process.
let retainedDraft: AssistantPreferences | null = null;
const equal = (a: AssistantPreferences, b: AssistantPreferences) =>
  a.instructions === b.instructions;

export function AssistantSettingsScreen({
  onBack,
}: {
  readonly onBack: () => void;
}) {
  const p = usePalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [draft, setDraft] = useState<AssistantPreferences | null>(
    retainedDraft,
  );
  const [baseline, setBaseline] = useState<AssistantPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const current = () =>
      mounted.current && loadGeneration.current === generation;
    setLoading(true);
    setReady(false);
    setError("");
    try {
      const value = await loadAssistantPreferences();
      if (!current()) return;
      setBaseline(value);
      setDraft(retainedDraft ?? value);
      setReady(true);
    } catch (cause) {
      if (current())
        setError(
          cause instanceof Error
            ? cause.message
            : "阅读助手设置读取失败，请重试。",
        );
    } finally {
      if (current()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadGeneration.current++;
    };
  }, [load]);

  const dirty = !!draft && (!baseline || !equal(draft, baseline));
  const overLimit =
    (draft?.instructions.length ?? 0) > ASSISTANT_INSTRUCTIONS_MAX_LENGTH;
  const update = (value: AssistantPreferences) => {
    if (savingRef.current || loading) return;
    retainedDraft = baseline && equal(value, baseline) ? null : value;
    setDraft(value);
    setSavedNotice(false);
    setError("");
  };
  const restore = () => {
    if (savingRef.current || loading) return;
    update({ ...DEFAULT_ASSISTANT_PREFERENCES });
    setReady(true);
  };
  const save = async () => {
    if (!draft || !ready || !dirty || overLimit || savingRef.current) return;
    const snapshot = draft;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setSavedNotice(false);
    try {
      await saveAssistantPreferences(snapshot);
      if (retainedDraft === snapshot) retainedDraft = null;
      if (mounted.current) {
        setBaseline(snapshot);
        setSavedNotice(true);
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "保存失败；草稿仍保留，请重试。",
        );
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <SettingsHeader
        title="阅读助手"
        onBack={onBack}
        actions={
          <SettingsAction
            title={saving ? "保存中" : "保存"}
            primary
            disabled={!ready || loading || saving || !dirty || overLimit}
            onPress={() => void save()}
          />
        }
      />
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <ActivityIndicator color={p.lampInk} style={styles.spinner} />
          ) : null}
          <Text style={styles.status} accessibilityLiveRegion="polite">
            {saving
              ? "正在保存…"
              : savedNotice
                ? "已保存，下一次提问生效。"
                : dirty && ready
                  ? "有未保存的修改；保存后，下一次提问生效。"
                  : "设置对所有书籍生效，不影响正在生成的回答。"}
          </Text>
          {error ? (
            <SettingsSection>
              <SettingsRow
                title={error}
                detail={
                  ready
                    ? "草稿仍保留，请再次保存。"
                    : "点按重试，或恢复默认后保存；已有设置未覆盖。"
                }
                danger
                {...(!ready ? { onPress: () => void load() } : {})}
              />
            </SettingsSection>
          ) : null}
          <SettingsSection
            title="助手指令"
            first
            footer="设置人设、语气、语言与回答详略。留空表示不添加个人指令。"
          >
            <TextInput
              testID="assistant-instructions"
              accessibilityLabel="助手指令，支持 Markdown"
              multiline
              textAlignVertical="top"
              style={styles.instructions}
              value={draft?.instructions ?? ""}
              editable={ready && !loading && !saving}
              placeholder="写下你希望阅读助手如何与你交流…"
              placeholderTextColor={p.ink3}
              onChangeText={(instructions) => {
                if (draft && ready) update({ ...draft, instructions });
              }}
            />
            <Text style={[styles.count, overLimit && styles.error]}>
              {draft?.instructions.length ?? 0} /{" "}
              {ASSISTANT_INSTRUCTIONS_MAX_LENGTH.toLocaleString("en-US")} 字符
              {overLimit ? " · 请缩短后保存" : ""}
            </Text>
          </SettingsSection>
          <SettingsSection footer="恢复默认只修改草稿，仍需保存。未保存的修改会在本次应用运行期间保留。">
            <View style={styles.restore}>
              <SettingsAction
                title="恢复默认"
                disabled={loading || saving}
                onPress={restore}
              />
            </View>
          </SettingsSection>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(p: ReturnType<typeof usePalette>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.paper },
    body: { flex: 1 },
    content: {
      paddingHorizontal: 24,
      paddingBottom: 40,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
    },
    spinner: { marginTop: 16 },
    status: {
      marginHorizontal: 4,
      marginTop: 12,
      color: p.ink3,
      fontSize: 13,
      lineHeight: 21,
    },
    instructions: {
      minHeight: 300,
      padding: 16,
      color: p.ink,
      fontSize: 17,
      lineHeight: 28,
    },
    count: {
      color: p.ink3,
      fontSize: 11,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    error: { color: p.error },
    restore: { alignItems: "flex-start", padding: 6 },
  });
}
