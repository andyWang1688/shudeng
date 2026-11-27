import { Pressable, StyleSheet, Text } from "react-native";
import { Undo2 } from "lucide-react-native";

export function ReaderReturnButton({ paper, ink, label = "返回原处", disabled = false, onPress }: {
  readonly paper: string;
  readonly ink: string;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: paper },
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Undo2 size={17} color={ink} />
      <Text style={[styles.label, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 22,
    borderCurve: "continuous",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  label: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  dimmed: { opacity: 0.5 },
});
