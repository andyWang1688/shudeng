import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { Image } from "expo-image";
import { font, type as typeScale, usePalette, type Palette } from "../theme";

type Props = {
  readonly title: string;
  readonly description?: string;
  readonly symbol?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly variant?: "default" | "shelf";
};

/** 空态：可选图标 + 标题/说明 + 主按钮；只表达业务空态。 */
export function EmptyState({
  title,
  description,
  symbol,
  actionLabel,
  onAction,
  variant = "default",
}: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={[styles.wrap, variant === "shelf" && styles.shelfWrap]}>
      {variant === "shelf" ? (
        <Image
          source={require("../settings/assets/brand-mark-mask.png")}
          style={styles.brand}
          tintColor={palette.lamp}
          contentFit="contain"
          accessible={false}
        />
      ) : symbol ? (
        <SymbolView name={symbol as never} size={44} tintColor={palette.lamp} />
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {description ? (
        <Text
          style={[
            styles.description,
            variant === "shelf" && styles.shelfDescription,
          ]}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          android_ripple={{ color: palette.line }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          {variant === "shelf" ? (
            <SymbolView
              name="plus"
              size={15}
              weight="semibold"
              tintColor={palette.paper}
            />
          ) : null}
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    wrap: { alignItems: "center", paddingVertical: 72, paddingHorizontal: 16 },
    shelfWrap: { paddingTop: 64, paddingBottom: 32, paddingHorizontal: 15 },
    brand: { width: 44, height: 44 },
    title: {
      marginTop: 20,
      fontSize: 24,
      fontFamily: font.serif,
      fontWeight: "600",
      color: palette.ink,
      textAlign: "center",
    },
    description: {
      marginTop: 8,
      fontSize: typeScale.caption,
      color: palette.ink2,
      textAlign: "center",
    },
    shelfDescription: { marginTop: 10, fontSize: 13, fontWeight: "500" },
    button: {
      marginTop: 24,
      flexDirection: "row",
      gap: 6,
      width: 168,
      height: 44,
      borderRadius: 12,
      backgroundColor: palette.ink,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    buttonText: { fontSize: 14, fontWeight: "500", color: palette.paper },
    pressed: { opacity: 0.72 },
  });
}
