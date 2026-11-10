import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image } from "expo-image";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SymbolView } from "expo-symbols";
import {
  bookSwatchTone,
  type as typeScale,
  usePalette,
  type Palette,
} from "../theme";

type Props = {
  readonly title: string;
  readonly count?: string;
  readonly countSuffix?: string;
  readonly variant?: "section" | "group";
  readonly swatch?: {
    readonly title: string;
    readonly format?: string | undefined;
    readonly coverUri?: string | null | undefined;
  };
  readonly expanded?: boolean;
  readonly transitionDuration?: number;
  readonly onPress?: () => void;
  readonly trailing?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
};

/** Group headers follow BookDesign.listGroupHeaderContent; section headers retain shelf styling. */
export function SectionHeader({
  title,
  count,
  countSuffix,
  variant = "section",
  swatch,
  expanded,
  transitionDuration = 0,
  onPress,
  trailing,
  style,
}: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [failedCoverUri, setFailedCoverUri] = useState<string | null>(null);
  if (variant === "section") {
    return (
      <View style={[styles.section, style]}>
        <View style={styles.sectionIdentity}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {count ? (
            <Text style={styles.sectionCount}>{countSuffix ?? count}</Text>
          ) : null}
        </View>
        {trailing}
      </View>
    );
  }
  const tone = swatch ? bookSwatchTone(swatch.title, swatch.format) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} ${count ?? ""}${countSuffix ?? ""}`}
      accessibilityState={{ expanded: expanded ?? false }}
      accessibilityValue={{ text: expanded ? "已展开" : "已收起" }}
      onPress={onPress}
      android_ripple={{ color: palette.line }}
      style={({ pressed }) => [styles.group, style, pressed && styles.pressed]}
    >
      {tone ? (
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.swatch, { backgroundColor: tone.background }]}
        >
          <Text style={[styles.swatchText, { color: tone.ink }]}>
            {swatch!.title.slice(0, 1)}
          </Text>
          {swatch?.coverUri && swatch.coverUri !== failedCoverUri ? (
            <Image
              source={{ uri: swatch.coverUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              onError={() => setFailedCoverUri(swatch.coverUri ?? null)}
            />
          ) : null}
        </View>
      ) : null}
      <View style={styles.groupBody}>
        <Text style={styles.groupTitle} numberOfLines={2}>
          {title}
        </Text>
        {count ? (
          <Text style={styles.groupCount}>
            {count}
            {countSuffix ?? ""}
          </Text>
        ) : null}
      </View>
      {onPress ? (
        <DisclosureChevron
          expanded={expanded ?? false}
          duration={transitionDuration}
          color={palette.lamp}
        />
      ) : (
        trailing
      )}
    </Pressable>
  );
}

function DisclosureChevron({
  expanded,
  duration,
  color,
}: {
  readonly expanded: boolean;
  readonly duration: number;
  readonly color: string;
}) {
  const rotation = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(rotation, {
      toValue: expanded ? 1 : 0,
      duration,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, duration, rotation]);
  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        transform: [
          {
            rotate: rotation.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "90deg"],
            }),
          },
        ],
      }}
    >
      <SymbolView
        name="chevron.right"
        size={13}
        weight="semibold"
        tintColor={color}
      />
    </Animated.View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    section: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 44,
      marginTop: 26,
    },
    sectionIdentity: { flexDirection: "row", alignItems: "baseline", gap: 6 },
    sectionTitle: {
      fontFamily: "Songti SC",
      fontSize: 17,
      fontWeight: "600",
      color: palette.ink,
    },
    sectionCount: { fontSize: typeScale.captionSmall, color: palette.ink3 },
    group: {
      minHeight: 76,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    pressed: { opacity: 0.7 },
    swatch: {
      width: 30,
      height: 42,
      borderRadius: 3,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    swatchText: {
      fontFamily: "SongtiSC-Bold",
      fontSize: 9.2,
      fontWeight: "600",
    },
    groupBody: { flex: 1 },
    groupTitle: {
      fontSize: 23,
      lineHeight: 31,
      fontWeight: "700",
      color: palette.ink,
    },
    groupCount: {
      marginTop: 5,
      fontSize: 13,
      lineHeight: 20,
      color: palette.ink3,
    },
  });
}
