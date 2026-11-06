import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { Check, Maximize2, Trash2, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DemoSheet } from "./DemoSheet";
import type { DemoAnnotation } from "./readerSamples";
import { demoColors as c } from "./demoTheme";

export function DemoAnnotationEditor({
  annotation,
  existing,
  onSave,
  onRemove,
  onClose,
}: {
  annotation: DemoAnnotation;
  existing: boolean;
  onSave: (record: DemoAnnotation) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const sheet = useRef<BottomSheet>(null);
  const [body, setBody] = useState(annotation.body);
  const insets = useSafeAreaInsets();
  const note = annotation.kind === "note";
  const close = () => sheet.current?.close();
  return (
    <DemoSheet ref={sheet} initialHeight={note ? 76 : 42} onClose={onClose}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭标注编辑"
          onPress={close}
          style={s.icon}
        >
          <X size={20} color={c.secondary} />
        </Pressable>
        <Text style={s.title}>
          {note ? (existing ? "编辑笔记" : "写笔记") : "高亮"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="全屏标注编辑"
          onPress={() => sheet.current?.snapToIndex(1)}
          style={s.icon}
        >
          <Maximize2 size={17} color={c.secondary} />
        </Pressable>
        {existing && note && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除笔记"
            onPress={() =>
              Alert.alert("删除这条笔记？", "删除后无法恢复。", [
                { text: "取消", style: "cancel" },
                {
                  text: "删除",
                  style: "destructive",
                  onPress: () => {
                    onRemove();
                    close();
                  },
                },
              ])
            }
            style={s.icon}
          >
            <Trash2 size={18} color={c.secondary} />
          </Pressable>
        )}
        {note ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="保存笔记"
            accessibilityState={{ disabled: !body.trim() }}
            disabled={!body.trim()}
            onPress={() => {
              onSave({ ...annotation, body: body.trim() });
              close();
            }}
            style={[s.icon, !body.trim() && s.disabled]}
          >
            <Text style={s.save}>保存</Text>
          </Pressable>
        ) : (
          <View style={s.icon} />
        )}
      </View>
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.content,
          { paddingBottom: Math.max(insets.bottom, 20) },
        ]}
      >
        <Text style={s.quote}>{annotation.quote}</Text>
        {note ? (
          <BottomSheetTextInput
            accessibilityLabel="笔记正文"
            value={body}
            onChangeText={setBody}
            placeholder="写下你的想法…"
            placeholderTextColor={c.muted}
            multiline
            textAlignVertical="top"
            style={s.input}
          />
        ) : (
          <>
            <View style={s.colors}>
              {[
                ["#EAD58A", "黄色"],
                ["#BFDBC4", "绿色"],
                ["#BCD6E7", "蓝色"],
                ["#E7BFC7", "粉色"],
              ].map(([color, label]) => (
                <Pressable
                  key={color}
                  accessibilityRole="button"
                  accessibilityLabel={label + "高亮"}
                  accessibilityState={{
                    selected: existing && color === annotation.color,
                  }}
                  onPress={() => {
                    if (existing && color === annotation.color) onRemove();
                    else onSave({ ...annotation, color: color! });
                    close();
                  }}
                  style={[s.color, { backgroundColor: color }]}
                >
                  {existing && color === annotation.color && (
                    <Check size={22} color={c.ink} />
                  )}
                </Pressable>
              ))}
            </View>
          </>
        )}
      </BottomSheetScrollView>
    </DemoSheet>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  title: {
    flex: 1,
    color: c.ink,
    fontSize: 19,
    fontWeight: "600",
    paddingLeft: 6,
  },
  icon: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  save: { color: c.accent, fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.35 },
  content: { paddingHorizontal: 26 },
  quote: {
    color: c.secondary,
    fontFamily: "Songti SC",
    fontSize: 17,
    lineHeight: 29,
    borderLeftWidth: 2,
    borderLeftColor: c.gold,
    paddingLeft: 14,
    marginVertical: 12,
  },
  input: {
    minHeight: 180,
    color: c.ink,
    fontSize: 18,
    lineHeight: 29,
    padding: 0,
    paddingTop: 16,
  },
  colors: {
    flexDirection: "row",
    justifyContent: "space-around",
    gap: 12,
    marginVertical: 20,
  },
  color: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  remove: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  removeLabel: { color: c.secondary, fontSize: 15 },
});
