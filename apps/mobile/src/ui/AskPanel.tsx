import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from './theme';

type Message = {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
};

const initialMessages: readonly Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: '问答面板占位。Agent 运行时由 @shudeng/core（LangGraph.js）提供，本任务只验证 Expo 壳与面板导航，不实现第二套 Agent。',
  },
];

export function AskPanel() {
  const router = useRouter();
  const [messages, setMessages] = useState<readonly Message[]>(initialMessages);
  const [question, setQuestion] = useState('');

  const send = () => {
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    setMessages((current) => [
      ...current,
      { id: `user-${current.length}`, role: 'user', text: trimmed },
      {
        id: `assistant-${current.length + 1}`,
        role: 'assistant',
        text: '占位回答：接入 @shudeng/core 的 AgentEvent 流后，这里会显示流式回答、思考过程、工具步骤与可跳转引用。',
      },
    ]);
    setQuestion('');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.toolbar}>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭问答面板" onPress={() => router.back()} style={styles.closeButton}>
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
          <Text style={styles.title}>问问书灯</Text>
          <View style={styles.placeholderChip}><Text style={styles.placeholderText}>占位</Text></View>
        </View>
        <ScrollView style={styles.messagesScroll} contentContainerStyle={styles.messages}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
              <Text style={[styles.messageText, message.role === 'user' ? styles.userText : styles.assistantText]}>{message.text}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="问题"
            value={question}
            onChangeText={setQuestion}
            placeholder="问问书灯…"
            placeholderTextColor={colors.ink3}
            style={styles.input}
            multiline
          />
          <Pressable accessibilityRole="button" accessibilityLabel="发送问题" onPress={send} style={styles.sendButton}>
            <Text style={styles.sendText}>发送</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  closeButton: { paddingVertical: 6, paddingRight: spacing.sm },
  closeText: { fontSize: 15, color: colors.lamp },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  placeholderChip: { borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.xs, paddingVertical: 3 },
  placeholderText: { fontSize: 11, color: colors.ink2 },
  messagesScroll: { flex: 1 },
  messages: { width: '100%', padding: spacing.md, gap: spacing.sm },
  bubble: { maxWidth: '92%', borderRadius: radius.card, padding: spacing.sm },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.lampWash },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  messageText: { fontSize: 14, lineHeight: 21 },
  userText: { color: colors.ink },
  assistantText: { color: colors.ink2 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    padding: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: radius.field,
    backgroundColor: colors.paperDeep,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
  },
  sendButton: { borderRadius: radius.field, backgroundColor: colors.lamp, paddingHorizontal: spacing.md, paddingVertical: 11 },
  sendText: { fontSize: 14, fontWeight: '600', color: colors.surface },
});
