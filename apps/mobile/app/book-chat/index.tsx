import { useEffect, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAppearance } from "../../src/ui/appearance";
import {
  ChatComposer,
  ChatList,
  ChatLoadingState,
  ChatSheet,
  useBookChat,
} from "../../src/ui/chat";
import { darkColors, lightColors, type Palette } from "../../src/ui/theme";
import { useOpenQuestionCitation, useQuestionPresentation } from "../../src/ui/reader-question/ReaderQuestionProvider";
import { questionAppearanceFromParams, resolveQuestionAppearance } from "../../src/ui/reader-question/session";
import { readerLocatorFromLegacy, storedLocatorFromUnknown } from "../../src/platform/library/pure";
import type { StoredReaderLocator } from "../../src/platform/library";

function originLocator(value: string | undefined): StoredReaderLocator | null {
  if (!value) return null;
  try {
    const stored = storedLocatorFromUnknown(JSON.parse(value));
    if (stored) return stored;
  } catch { /* Legacy CFI strings are not JSON. */ }
  return readerLocatorFromLegacy(value, 'PDF') ?? readerLocatorFromLegacy(value, 'EPUB');
}

function paramValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** 书内 AI 问答：只做路由/主题/Sheet 编排；数据在 useBookChat，视图在 src/ui/chat。 */
export default function BookChatRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { resolvedMode } = useAppearance();
  const params = useLocalSearchParams<{
    bookId?: string | string[];
    bookTitle?: string | string[];
    selectionQuote?: string | string[];
    locator?: string | string[];
    initialQuestion?: string | string[];
    conversationId?: string | string[];
    questionPresentationId?: string | string[];
    appearance?: string | string[];
    /** Compatibility for theme-only links and fixed EPUB reader themes. */
    theme?: string | string[];
  }>();
  const appearance = questionAppearanceFromParams(params);
  const bookId = paramValue(params.bookId) ?? "";
  const presentation = useQuestionPresentation({
    presentationId: paramValue(params.questionPresentationId), bookId,
    conversationId: paramValue(params.conversationId), title: paramValue(params.bookTitle),
    selectionQuote: paramValue(params.selectionQuote), initialQuestion: paramValue(params.initialQuestion),
    origin: originLocator(paramValue(params.locator)), theme: resolveQuestionAppearance(appearance, resolvedMode), appearance,
  });
  const palette: Palette = resolveQuestionAppearance(presentation.appearance, resolvedMode) === 'dark' ? darkColors : lightColors;
  const view = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot);
  const openCitation = useOpenQuestionCitation(presentation);
  useEffect(() => {
    if (paramValue(params.questionPresentationId) !== presentation.id) router.setParams({ questionPresentationId: presentation.id });
  }, [params.questionPresentationId, presentation.id, router]);
  const chat = useBookChat({
    bookId,
    conversationId: presentation.conversationId,
    bookTitleParam: presentation.title,
    selectionQuote: presentation.selectionQuote,
    initialQuestion: presentation.initialQuestion,
    readingPosition: presentation.origin ? JSON.stringify(presentation.origin) : undefined,
    presentation,
  });

  return (
    <ChatSheet
      palette={palette}
      bottomInset={insets.bottom}
      onClose={() => router.back()}
    >
      {chat.loading ? (
        <ChatLoadingState palette={palette} />
      ) : (
        <View style={{ flex: 1 }}>
          <ChatList
            turns={chat.turns}
            bookId={bookId}
            bookTitle={chat.title}
            format={chat.format}
            sourceAvailable={Boolean(
              chat.availability?.book &&
                chat.availability.book.removedAt === null,
            )}
            indexMissing={chat.indexMissing}
            loadError={chat.loadError}
            indexDetail={chat.indexDetail}
            onRetry={chat.retry}
            palette={palette}
            presentation={presentation}
            onOpenCitation={openCitation}
          />
          <ChatComposer
            question={chat.question}
            onChangeQuestion={chat.setQuestion}
            selection={view.selection}
            onSelectionChange={selection => presentation.update({ selection })}
            placeholder={chat.placeholder}
            running={chat.running}
            canSend={chat.canSend}
            inputEnabled={Boolean(chat.availability?.book)}
            configMissing={chat.configMissing}
            selectionPending={chat.selectionPending}
            service={chat.service}
            turnsCount={chat.turns.length}
            contextUsage={chat.contextUsage}
            contextEstimate={chat.contextEstimate}
            hasExternalMaterials={chat.hasExternalMaterials}
            onSend={() => void chat.send()}
            onCancel={chat.cancel}
            onOpenSettings={() => router.push("/book-chat/ai-settings")}
            palette={palette}
          />
        </View>
      )}
    </ChatSheet>
  );
}
