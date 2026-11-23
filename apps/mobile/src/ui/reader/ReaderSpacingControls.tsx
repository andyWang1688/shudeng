import { Pressable, StyleSheet, Text, View } from "react-native";
import { readerSpacingSettings, type ReaderSpacing } from "@shudeng/core/domain/reader-spacing";
import type { Palette } from "../theme";

type StepperPalette = Pick<Palette, "paperDeep" | "ink2" | "lampInk">;

export function ReaderValueStepper({ label, value, min, max, step, palette, disabled = false, onAdjust }: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly palette: StepperPalette;
  readonly disabled?: boolean;
  readonly onAdjust: (delta: number) => void;
}) {
  const decreaseDisabled = disabled || value <= min;
  const increaseDisabled = disabled || value >= max;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.ink2 }]}>{label}</Text>
      <View style={[styles.row, { backgroundColor: palette.paperDeep }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"缩小" + label}
          accessibilityState={{ disabled: decreaseDisabled }}
          disabled={decreaseDisabled}
          onPress={() => onAdjust(-step)}
          style={[styles.button, decreaseDisabled && styles.disabled]}
        >
          <Text style={[styles.action, { color: palette.lampInk }]}>−</Text>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: palette.ink2 }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"增大" + label}
          accessibilityState={{ disabled: increaseDisabled }}
          disabled={increaseDisabled}
          onPress={() => onAdjust(step)}
          style={[styles.button, increaseDisabled && styles.disabled]}
        >
          <Text style={[styles.action, { color: palette.lampInk }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const fields = [["letterSpacing", "字距"], ["lineSpacing", "行距"]] as const;

export function ReaderSpacingControls({ spacing, palette, disabled = false, onAdjust }: {
  readonly spacing: ReaderSpacing;
  readonly palette: StepperPalette;
  readonly disabled?: boolean;
  readonly onAdjust: (field: keyof ReaderSpacing, delta: number) => void;
}) {
  return fields.map(([field, label]) => (
    <ReaderValueStepper
      key={field}
      label={label}
      value={spacing[field]}
      {...readerSpacingSettings[field]}
      palette={palette}
      disabled={disabled}
      onAdjust={(delta) => onAdjust(field, delta)}
    />
  ));
}

const styles = StyleSheet.create({
  field: { marginTop: 12, gap: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { marginLeft: 4, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12 },
  button: { minHeight: 52, minWidth: 64, alignItems: "center", justifyContent: "center" },
  action: { fontSize: 16 },
  divider: { width: StyleSheet.hairlineWidth, height: 20, opacity: 0.25 },
  disabled: { opacity: 0.38 },
});
