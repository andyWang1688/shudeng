import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, Pencil, Plus } from "lucide-react-native";
import type { DemoService } from "./DemoModelSettings";
import { demoColors as c } from "./demoTheme";

export type DemoServiceListProps = {
  services: DemoService[];
  selectedId: string;
  notice: string;
  onSelect: (service: DemoService) => void;
  onEdit: (service: DemoService) => void;
  onAdd: () => void;
  onRemove: (service: DemoService) => void;
};

/** Other platforms retain explicit edit/delete in the service editor. */
export function DemoServiceList({
  services,
  selectedId,
  notice,
  onSelect,
  onEdit,
  onAdd,
}: DemoServiceListProps) {
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.label}>当前服务</Text>
      <View style={s.group}>
        {services.map((service) => (
          <View key={service.id} style={s.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={"使用 " + service.name}
              accessibilityState={{ selected: service.id === selectedId }}
              onPress={() => onSelect(service)}
              style={s.selection}
            >
              <View style={[s.radio, service.id === selectedId && s.selected]}>
                {service.id === selectedId && (
                  <Check size={13} color={c.surface} accessible={false} />
                )}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.title}>{service.name}</Text>
                <Text style={s.detail}>{service.model}</Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={"编辑 " + service.name}
              onPress={() => onEdit(service)}
              style={s.edit}
            >
              <Pencil size={18} color={c.secondary} accessible={false} />
            </Pressable>
          </View>
        ))}
        <Pressable accessibilityRole="button" onPress={onAdd} style={s.add}>
          <Plus size={20} color={c.accent} accessible={false} />
          <Text style={[s.title, { color: c.accent }]}>添加 AI 服务</Text>
        </Pressable>
      </View>
      <Text style={s.hint} accessibilityLiveRegion="polite">
        {notice}
      </Text>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  content: { padding: 24, width: "100%", maxWidth: 760, alignSelf: "center" },
  label: { color: c.secondary, fontSize: 13, marginBottom: 10 },
  group: { backgroundColor: c.surface, borderRadius: 16, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  selection: {
    flex: 1,
    minHeight: 80,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    paddingVertical: 16,
    paddingLeft: 17,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: c.line,
    alignItems: "center",
    justifyContent: "center",
  },
  selected: { backgroundColor: c.accent, borderColor: c.accent },
  edit: {
    minWidth: 52,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  title: { color: c.ink, fontSize: 17 },
  detail: { color: c.secondary, fontSize: 14 },
  add: {
    minHeight: 60,
    padding: 17,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  hint: { color: c.secondary, fontSize: 12, lineHeight: 20, marginTop: 10 },
});
