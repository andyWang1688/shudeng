import { Children, type ReactNode } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { usePalette } from "../theme";
export function SettingsHeader({
  title,
  onBack,
  actions,
  backTitle,
  centered = true,
  modal = false,
}: {
  readonly title: string;
  readonly onBack: () => void;
  readonly actions?: ReactNode;
  readonly backTitle?: string;
  readonly centered?: boolean;
  readonly modal?: boolean;
}) {
  const p = usePalette();
  return (
    <View style={[styles.header, modal ? styles.modalHeader : undefined]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backTitle ?? "返回"}
        onPress={onBack}
        style={[styles.back, backTitle ? styles.textBack : undefined]}
      >
        {backTitle ? (
          <Text style={[styles.actionText, { color: p.ink }]}>{backTitle}</Text>
        ) : (
          <SymbolView name="chevron.left" size={20} tintColor={p.ink} />
        )}
      </Pressable>
      {centered ? (
        <View
          pointerEvents="none"
          style={[styles.titleSlot, modal ? { top: 16 } : undefined]}
        >
          <Text style={[styles.title, { color: p.ink }]}>{title}</Text>
        </View>
      ) : (
        <Text style={[styles.title, styles.leadingTitle, { color: p.ink }]}>
          {title}
        </Text>
      )}
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}
export function showSettingsChoices(
  title: string,
  choices: readonly { readonly title: string; readonly onPress: () => void }[],
): void {
  if (Platform.OS === "ios")
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...choices.map((choice) => choice.title), "取消"],
        cancelButtonIndex: choices.length,
      },
      (index) => choices[index]?.onPress(),
    );
  else
    Alert.alert(title, undefined, [
      ...choices.map((choice) => ({
        text: choice.title,
        onPress: choice.onPress,
      })),
      { text: "取消", style: "cancel" },
    ]);
}
export function SettingsAction({
  title,
  onPress,
  disabled = false,
  primary = false,
}: {
  readonly title: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly primary?: boolean;
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        {
          backgroundColor: primary ? p.ink : "transparent",
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text style={[styles.actionText, { color: primary ? p.paper : p.ink }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function SettingsSection({
  title,
  footer,
  children,
  first = false,
  formFirst = false,
}: {
  readonly title?: string;
  readonly footer?: string;
  readonly children: ReactNode;
  readonly first?: boolean;
  readonly formFirst?: boolean;
}) {
  const p = usePalette();
  return (
    <View
      style={[
        styles.section,
        title ? styles.titledSection : undefined,
        first ? styles.firstSection : undefined,
        formFirst ? styles.formFirstSection : undefined,
      ]}
    >
      {title ? (
        <Text
          accessibilityRole="header"
          style={[styles.sectionTitle, { color: p.ink2 }]}
        >
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: p.surface }]}>
        {Children.toArray(children).map((child, index, rows) => (
          <View key={index}>
            {child}
            {index < rows.length - 1 ? (
              <View style={[styles.separator, { backgroundColor: p.line }]} />
            ) : null}
          </View>
        ))}
      </View>
      {footer ? (
        <Text
          style={[styles.footer, { color: p.ink2 }]}
          lineBreakStrategyIOS="standard"
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
export function SettingsRow({
  title,
  detail,
  testID,
  accessibilityValue,
  onPress,
  selected = false,
  danger = false,
  trailing,
  leading,
  compact = false,
  muted = false,
  disabled = false,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly testID?: string;
  readonly accessibilityValue?: string;
  readonly onPress?: (() => void) | undefined;
  readonly selected?: boolean;
  readonly danger?: boolean;
  readonly trailing?: ReactNode;
  readonly leading?: ReactNode;
  readonly compact?: boolean;
  readonly muted?: boolean;
  readonly disabled?: boolean;
}) {
  const p = usePalette();
  const content = (
    <>
      {leading}
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowTitle,
            {
              color: danger
                ? p.error
                : selected
                  ? p.lampInk
                  : muted
                    ? p.ink2
                    : p.ink,
              fontSize: compact ? 14 : 17,
            },
          ]}
        >
          {title}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: p.ink3 }]}>{detail}</Text>
        ) : null}
      </View>
      {trailing !== undefined ? (
        trailing
      ) : selected ? (
        <SymbolView name="checkmark" size={20} tintColor={p.lampInk} />
      ) : onPress ? (
        <SymbolView name="chevron.right" size={14} tintColor={p.ink3} />
      ) : null}
    </>
  );
  return onPress ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      {...(accessibilityValue !== undefined
        ? { accessibilityValue: { text: accessibilityValue } }
        : {})}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        detail ? styles.subtitleRow : undefined,
        {
          borderBottomColor: p.line,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={[styles.row, detail ? styles.subtitleRow : undefined]}>
      {content}
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
    justifyContent: "space-between",
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  modalHeader: { paddingTop: 16, minHeight: 60 },
  textBack: { width: 66 },
  titleSlot: {
    position: "absolute",
    left: 76,
    right: 76,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, lineHeight: 25, fontWeight: "600" },
  leadingTitle: { flex: 1 },
  actions: { flexDirection: "row", gap: 12 },
  action: {
    borderRadius: 24,
    minHeight: 44,
    minWidth: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionText: { fontSize: 16, lineHeight: 24, fontWeight: "600" },
  section: { marginTop: 32 },
  titledSection: { marginTop: 32 },
  firstSection: { marginTop: 12 },
  formFirstSection: { marginTop: 16 },
  sectionTitle: {
    marginHorizontal: 4,
    marginBottom: 10,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "400",
  },
  group: { borderRadius: 16, borderCurve: "continuous", overflow: "hidden" },
  footer: { marginHorizontal: 4, marginTop: 12, fontSize: 13, lineHeight: 21 },
  row: {
    minHeight: 62,
    paddingHorizontal: 17,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  subtitleRow: { minHeight: 70 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: 17 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 17, lineHeight: 25 },
  detail: { marginTop: 3, fontSize: 13, lineHeight: 20 },
});
