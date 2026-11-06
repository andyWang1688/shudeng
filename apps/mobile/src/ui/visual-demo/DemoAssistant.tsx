/** Throwaway visual prototype. Messages and references are local sample content. */
import { createContext, useContext, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import BottomSheet, {
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  Maximize2,
  X,
} from "lucide-react-native";
import { demoColors as c } from "./demoTheme";
import type { DemoBook } from "./demoBooks";

import { DemoSheet } from "./DemoSheet";
type Message = { id: number; question: string };
type ComposerState = {
  value: string;
  setValue: (value: string) => void;
  send: () => void;
  bottom: number;
};
const ComposerContext = createContext<ComposerState | null>(null);

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
              accessibilityState={{ disabled: !composer.value.trim() }}
              onPress={composer.send}
              style={({ pressed }) => [
                styles.send,
                !composer.value.trim() && styles.sendDisabled,
                pressed && { opacity: 0.65 },
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
  initialSelection,
  book,
  open,
}: {
  onClose: () => void;
  initialQuestion?: string;
  initialSelection: string | undefined;
  book: DemoBook;
  open: boolean;
}) {
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheet>(null);
  const [value, setValue] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, question: initialQuestion || book.question },
  ]);
  const [reference, setReference] = useState<string | null>(null);
  const [selectionExpanded, setSelectionExpanded] = useState(false);
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
    <ComposerContext value={{ value, setValue, send, bottom: insets.bottom }}>
      <DemoSheet
        ref={sheet}
        open={open}
        initialHeight={76}
        onClose={onClose}
        footerComponent={SheetComposer}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.bookName}>{book.title}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="全屏问答"
              onPress={() => sheet.current?.snapToIndex(1)}
              style={styles.close}
            >
              <Maximize2 size={17} color={c.secondary} />
            </Pressable>
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
        </View>
        <BottomSheetScrollView
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {messages.map((message) => (
            <View key={message.id} style={styles.exchange}>
              <View style={styles.question}>
                {message.id === 0 && initialSelection && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="查看提问选文"
                    accessibilityState={{ expanded: selectionExpanded }}
                    onPress={() => setSelectionExpanded((value) => !value)}
                    style={styles.selection}
                  >
                    <View style={styles.selectionHeading}>
                      <Text style={styles.selectionLabel}>提问选文</Text>
                      <Text style={styles.selectionLabel}>
                        {selectionExpanded ? "收起" : "展开"}
                      </Text>
                    </View>
                    <Text
                      numberOfLines={selectionExpanded ? undefined : 2}
                      style={styles.selectionText}
                    >
                      {initialSelection}
                    </Text>
                  </Pressable>
                )}
                <Text style={styles.questionText}>{message.question}</Text>
              </View>
              <View style={styles.answer}>
                <Text style={styles.answerText}>{book.answer}</Text>
                <View style={styles.references}>
                  {[{ chapter: book.chapter, text: book.paragraphs[0] }].map(
                    (item, index) => {
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
                                《{book.title}》
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    },
                  )}
                </View>
              </View>
            </View>
          ))}
        </BottomSheetScrollView>
      </DemoSheet>
    </ComposerContext>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", gap: 4 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 12,
  },
  bookName: { color: c.ink, fontSize: 16, fontWeight: "600", lineHeight: 23 },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -10,
  },
  messages: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 180 },
  exchange: { marginBottom: 30 },
  question: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    backgroundColor: c.tint,
    borderRadius: 18,
    paddingHorizontal: 17,
    paddingVertical: 13,
    marginBottom: 28,
  },
  questionText: { color: c.ink, fontSize: 17, lineHeight: 27 },
  selection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
    paddingBottom: 12,
    marginBottom: 12,
  },
  selectionHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 7,
  },
  selectionLabel: { color: c.secondary, fontSize: 12, lineHeight: 19 },
  selectionText: { color: c.secondary, fontSize: 14, lineHeight: 23 },
  answer: { gap: 16 },
  answerText: { color: c.ink, fontSize: 17, lineHeight: 30 },
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
  referenceTitle: { color: c.secondary, fontSize: 13, lineHeight: 20 },
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
    shadowColor: c.ink,
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
    height: 44,
    width: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.accent,
  },
  sendDisabled: { opacity: 0.38 },
});
