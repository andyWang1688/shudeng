import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookOpen, MessageCircle, UserRound } from "lucide-react-native";
import { usePalette, type Palette } from "./theme";
import { useHaptics } from "./components/useHaptics";
import { useTabInteractionLocked } from "./tabInteraction";

type TabRoute = { readonly key: string; readonly name: string };
type TabBarProps = {
  readonly state: {
    readonly index: number;
    readonly routes: readonly TabRoute[];
  };
  readonly navigateToTab: (routeKey: string) => void;
};

const TAB_META: Record<string, { label: string }> = {
  "(shelf)": {
    label: "书架",
  },
  conversations: {
    label: "对话",
  },
  "(profile)": {
    label: "我的",
  },
};
const TAB_ICONS = {
  "(shelf)": BookOpen,
  conversations: MessageCircle,
  "(profile)": UserRound,
};

/** Expo Router Tabs 自定义底栏：通过 Tabs 提供的切换动作保留各栏状态。 */
export function BottomBar({ state, navigateToTab }: TabBarProps) {
  const haptics = useHaptics();
  const locked = useTabInteractionLocked();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View
      accessibilityElementsHidden={locked}
      importantForAccessibility={locked ? "no-hide-descendants" : "auto"}
      style={[
        styles.bar,
        { height: 56 + insets.bottom, paddingBottom: insets.bottom },
      ]}
    >
      {state.routes.map((route, index) => {
        const meta = TAB_META[route.name];
        if (!meta) return null;
        const on = state.index === index;
        const Icon = TAB_ICONS[route.name as keyof typeof TAB_ICONS];
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={meta.label}
            accessibilityState={on ? { selected: true } : {}}
            disabled={locked}
            onPress={() => {
              if (on) return;
              haptics();
              navigateToTab(route.key);
            }}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <Icon
                size={23}
                color={on ? palette.lamp : palette.ink3}
                strokeWidth={on ? 2 : 1.5}
                accessible={false}
              />
            </View>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={[styles.label, on && styles.on]}
            >
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.line,
      backgroundColor: palette.paper,
      paddingHorizontal: 6,
    },
    item: {
      flex: 1,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { opacity: 0.7 },
    iconSlot: {
      width: 22,
      height: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      marginTop: 3,
      fontSize: 11,
      lineHeight: 17,
      fontWeight: "500",
      color: palette.ink3,
    },
    on: { color: palette.lamp },
  });
}
