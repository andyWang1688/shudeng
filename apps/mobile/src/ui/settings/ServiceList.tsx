import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, Pencil, Plus } from "lucide-react-native";
import type { AIService } from "../../platform/aiConfig";
import { usePalette, type Palette } from "../theme";

export type ServiceListProps = {
  readonly services: readonly AIService[];
  readonly selectedId: string | null;
  readonly notice: string;
  readonly disabled: boolean;
  readonly onSelect: (service: AIService) => void;
  readonly onEdit: (service: AIService) => void;
  readonly onAdd: () => void;
  readonly onRemove: (service: AIService) => void;
};

/** Platforms without native swipe actions retain deletion in the service editor. */
export function ServiceList({ services, selectedId, notice, disabled, onSelect, onEdit, onAdd }: ServiceListProps) {
  const p = usePalette();
  const s = useMemo(() => makeStyles(p), [p]);
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.label}>当前服务</Text>
      <View style={[s.group, disabled && { opacity: 0.5 }]}>
        {services.map((service) => (
          <View key={service.id} style={s.row}>
            <Pressable accessibilityRole="button" accessibilityLabel={"使用 " + service.name}
              accessibilityState={{ selected: service.id === selectedId, disabled }} disabled={disabled}
              onPress={() => onSelect(service)} style={({ pressed }) => [s.selection, pressed && s.pressed]}>
              <View style={[s.radio, service.id === selectedId && s.selected]}>
                {service.id === selectedId && <Check size={13} color={p.surface} accessible={false} />}
              </View>
              <View style={s.rowText}>
                <Text style={s.title}>{service.name}</Text>
                <Text style={s.detail}>{service.model}</Text>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={"编辑 " + service.name}
              accessibilityState={{ disabled }} disabled={disabled} onPress={() => onEdit(service)}
              style={({ pressed }) => [s.edit, pressed && s.pressed]}>
              <Pencil size={18} color={p.ink2} accessible={false} />
            </Pressable>
          </View>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="添加 AI 服务"
          accessibilityState={{ disabled }} disabled={disabled} onPress={onAdd} style={({ pressed }) => [s.add, pressed && s.pressed]}>
          <Plus size={20} color={p.lampInk} accessible={false} />
          <Text style={[s.title, { color: p.lampInk }]}>添加 AI 服务</Text>
        </Pressable>
      </View>
      <Text style={s.hint} accessibilityLiveRegion="polite">{notice}</Text>
    </ScrollView>
  );
}
function makeStyles(p: Palette) {
  return StyleSheet.create({
    content: { padding: 24, width: "100%", maxWidth: 760, alignSelf: "center" },
    label: { color: p.ink2, fontSize: 13, lineHeight: 20, marginBottom: 10 },
    group: { backgroundColor: p.surface, borderRadius: 16, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.line },
    selection: { flex: 1, minHeight: 80, flexDirection: "row", gap: 14, alignItems: "center", paddingVertical: 16, paddingLeft: 17 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: p.ink3, alignItems: "center", justifyContent: "center" },
    selected: { backgroundColor: p.lampInk, borderColor: p.lampInk },
    rowText: { flex: 1, minWidth: 0, gap: 4 },
    edit: { minWidth: 52, minHeight: 56, alignItems: "center", justifyContent: "center", marginHorizontal: 4 },
    title: { color: p.ink, fontSize: 17, lineHeight: 25 },
    detail: { color: p.ink2, fontSize: 14, lineHeight: 22 },
    add: { minHeight: 60, padding: 17, flexDirection: "row", gap: 14, alignItems: "center" },
    hint: { color: p.ink2, fontSize: 13, lineHeight: 21, marginTop: 10 },
    pressed: { opacity: 0.6 },
  });
}
