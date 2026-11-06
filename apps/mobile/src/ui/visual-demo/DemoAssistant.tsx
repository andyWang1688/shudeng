/** Throwaway visual prototype. Messages and references are local sample content. */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetHandle,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
  type BottomSheetBackgroundProps,
  type BottomSheetFooterProps,
  type BottomSheetHandleProps,
} from "@gorhom/bottom-sheet";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUp, BookOpen, ChevronDown, X } from "lucide-react-native";
import { demoColors as c } from "./demoTheme";

const SNAP_POINTS = ["76%", "100%"];
const EXAMPLE_QUESTION = "如何理解瓦尔登湖中的简朴生活？";
const ANSWER = "梭罗说的简朴，不只是减少物品，而是把时间重新留给重要的事。";
const REFERENCES = [
  {
    chapter: "第一章 · 经济篇",
    text: "一个东西的成本，就是为了它而付出的生命。",
  },
  {
    chapter: "第五章 · 寂寞",
    text: "我爱独处。我还没有碰到比寂寞更好的同伴了。",
  },
];
type Message = { id: number; question: string };
type ComposerState = {
  value: string;
  setValue: (value: string) => void;
  send: () => void;
  bottom: number;
  top: number;
};
const ComposerContext = createContext<ComposerState | null>(null);

function SheetBackground({
  animatedIndex,
  pointerEvents,
  style,
}: BottomSheetBackgroundProps) {
  const corners = useAnimatedStyle(() => {
    const corner = interpolate(
      animatedIndex.get(),
      [0, 1],
      [24, 0],
      Extrapolation.CLAMP,
    );
    return { borderTopLeftRadius: corner, borderTopRightRadius: corner };
  });
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[style, styles.background, corners]}
    />
  );
}

function SheetHandle({ animatedIndex, ...props }: BottomSheetHandleProps) {
  const top = useContext(ComposerContext)?.top ?? 0;
  const safeArea = useAnimatedStyle(() => ({
    paddingTop: interpolate(
      animatedIndex.get(),
      [0, 1],
      [0, top],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <Animated.View style={safeArea}>
      <BottomSheetHandle {...props} animatedIndex={animatedIndex} />
    </Animated.View>
  );
}

function SheetComposer(props: BottomSheetFooterProps) {
  const composer = useContext(ComposerContext);
  if (!composer) return null;
  return (
    <BottomSheetFooter {...props} bottomInset={0}>
      <View
        pointerEvents="box-none"
        style={[
          styles.composerOuter,
          { paddingBottom: Math.max(composer.bottom, 12) },
        ]}
      >
        <View style={styles.composer}>
          <BottomSheetTextInput
            value={composer.value}
            onChangeText={composer.setValue}
            placeholder="问问这本书…"
            placeholderTextColor={c.muted}
            multiline
            accessibilityLabel="输入关于这本书的问题"
            style={styles.input}
          />
          <View style={styles.composerActions}>
            <View style={styles.scope}>
              <BookOpen size={13} color={c.accent} />
              <Text style={styles.scopeText}>当前书籍</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="发送问题"
              disabled={!composer.value.trim()}
              onPress={composer.send}
              style={[
                styles.send,
                !composer.value.trim() && styles.sendDisabled,
              ]}
            >
              <ArrowUp size={19} color={c.surface} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetFooter>
  );
}

export function DemoAssistant({
  onClose,
  initialQuestion,
}: {
  onClose: () => void;
  initialQuestion?: string;
}) {
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheet>(null);
  const [value, setValue] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, question: initialQuestion || EXAMPLE_QUESTION },
  ]);
  const [reference, setReference] = useState<string | null>(null);
  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.25}
        pressBehavior="close"
      />
    ),
    [],
  );
  const send = () => {
    if (!value.trim()) return;
    setMessages((items) => [
      ...items,
      { id: Date.now(), question: value.trim() },
    ]);
    setValue("");
    Keyboard.dismiss();
  };
  return (
    <ComposerContext
      value={{ value, setValue, send, bottom: insets.bottom, top: insets.top }}
    >
      <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
        <BottomSheet
          ref={sheet}
          index={0}
          snapPoints={SNAP_POINTS}
          enableDynamicSizing={false}
          enablePanDownToClose
          topInset={0}
          bottomInset={0}
          onClose={onClose}
          backgroundComponent={SheetBackground}
          handleComponent={SheetHandle}
          backdropComponent={backdrop}
          footerComponent={SheetComposer}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          enableBlurKeyboardOnGesture
          handleIndicatorStyle={styles.handle}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.bookName}>瓦尔登湖</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="收起问答"
              onPress={() => {
                Keyboard.dismiss();
                sheet.current?.close();
              }}
              style={styles.close}
            >
              <X size={19} color={c.secondary} />
            </Pressable>
          </View>
          <BottomSheetScrollView
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {messages.map((message) => (
              <View key={message.id} style={styles.exchange}>
                <View style={styles.question}>
                  <Text style={styles.questionText}>{message.question}</Text>
                </View>
                <View style={styles.answer}>
                  <Text style={styles.answerText}>{ANSWER}</Text>
                  <Text style={styles.answerText}>
                    生活的成本，也包括为了它付出的时间。简化生活，是为了有余地选择怎样度过自己的一天。
                  </Text>
                  <Text style={styles.answerText}>
                    独处则让他更清楚地听见自己的想法。简朴和独处，最终都指向一种更主动的生活。
                  </Text>
                  <View style={styles.references}>
                    {REFERENCES.map((item, index) => {
                      const key = `${message.id}-${index}`;
                      const expanded = reference === key;
                      return (
                        <View key={key} style={styles.reference}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`查看引用${index + 1}：${item.chapter}`}
                            accessibilityState={{ expanded }}
                            onPress={() => setReference(expanded ? null : key)}
                            style={styles.referenceButton}
                          >
                            <Text style={styles.referenceNumber}>
                              {index + 1}
                            </Text>
                            <Text style={styles.referenceTitle}>
                              {item.chapter}
                            </Text>
                            <ChevronDown
                              size={13}
                              color={c.muted}
                              style={{
                                transform: [
                                  { rotate: expanded ? "180deg" : "0deg" },
                                ],
                              }}
                            />
                          </Pressable>
                          {expanded && (
                            <View style={styles.quote}>
                              <Text style={styles.quoteText}>{item.text}</Text>
                              <Text style={styles.quoteCaption}>
                                《瓦尔登湖》 · 示例原文
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            ))}
          </BottomSheetScrollView>
        </BottomSheet>
      </View>
    </ComposerContext>
  );
}

const styles = StyleSheet.create({
  background: { backgroundColor: c.paper, borderCurve: "continuous" },
  sheet: {
    shadowColor: "#17251C",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 10,
  },
  handle: { width: 32, height: 4, backgroundColor: "#BAC4BA" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 20,
  },
  bookName: { color: c.ink, fontSize: 16, fontWeight: "600", lineHeight: 23 },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -10,
  },
  messages: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 170 },
  exchange: { marginBottom: 30 },
  question: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    backgroundColor: c.tint,
    borderRadius: 18,
    borderBottomRightRadius: 5,
    paddingHorizontal: 17,
    paddingVertical: 13,
    marginBottom: 28,
  },
  questionText: { color: c.ink, fontSize: 15, lineHeight: 24 },
  answer: { gap: 16 },
  answerText: { color: c.ink, fontSize: 16, lineHeight: 28 },
  references: { gap: 4, paddingTop: 2 },
  reference: { alignSelf: "stretch" },
  referenceButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
  },
  referenceNumber: {
    width: 20,
    height: 20,
    textAlign: "center",
    lineHeight: 20,
    fontSize: 11,
    fontWeight: "600",
    color: c.accent,
    backgroundColor: c.accentWash,
    borderRadius: 5,
    overflow: "hidden",
  },
  referenceTitle: { color: c.secondary, fontSize: 12, lineHeight: 18 },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: c.gold,
    marginLeft: 9,
    marginTop: 2,
    marginBottom: 12,
    paddingLeft: 14,
    paddingVertical: 6,
  },
  quoteText: {
    fontFamily: "Songti SC",
    color: c.ink,
    fontSize: 16,
    lineHeight: 27,
  },
  quoteCaption: { color: c.muted, fontSize: 11, lineHeight: 18, marginTop: 8 },
  composerOuter: { paddingHorizontal: 16, paddingTop: 10 },
  composer: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 10,
    shadowColor: "#203729",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 8,
  },
  input: {
    color: c.ink,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 27,
    maxHeight: 110,
    padding: 0,
    paddingTop: 0,
  },
  composerActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
  },
  scope: { flexDirection: "row", alignItems: "center", gap: 5 },
  scopeText: { color: c.secondary, fontSize: 11, lineHeight: 17 },
  send: {
    height: 34,
    width: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.accent,
  },
  sendDisabled: { opacity: 0.38 },
});
