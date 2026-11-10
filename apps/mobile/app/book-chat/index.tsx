import { useEffect, type ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScopedTheme } from "uniwind";
import { useAppearance } from "../../src/ui/appearance";
import { ChatSheet, useBookChat } from "../../src/ui/chat";
import { ReaderAssistantThread } from "../../src/ui/chat/ReaderAssistantThread";
import { darkColors, lightColors, type Palette } from "../../src/ui/theme";
import {
  useOpenQuestionCitation,
  useQuestionPresentation,
} from "../../src/ui/reader-question/ReaderQuestionProvider";
import {
  questionAppearanceFromParams,
  resolveQuestionAppearance,
} from "../../src/ui/reader-question/session";
import {
  readerLocatorFromLegacy,
  storedLocatorFromUnknown,
} from "../../src/platform/library/pure";
import type { StoredReaderLocator } from "../../src/platform/library";

function originLocator(value: string | undefined): StoredReaderLocator | null {
  if (!value) return null;
  try {
    const stored = storedLocatorFromUnknown(JSON.parse(value));
    if (stored) return stored;
  } catch {
    /* Legacy CFI strings are not JSON. */
  }
  return (
    readerLocatorFromLegacy(value, "PDF") ??
    readerLocatorFromLegacy(value, "EPUB")
  );
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
    presentationId: paramValue(params.questionPresentationId),
    bookId,
    conversationId: paramValue(params.conversationId),
    title: paramValue(params.bookTitle),
    selectionQuote: paramValue(params.selectionQuote),
    initialQuestion: paramValue(params.initialQuestion),
    origin: originLocator(paramValue(params.locator)),
    theme: resolveQuestionAppearance(appearance, resolvedMode),
    appearance,
  });
  const palette: Palette =
    resolveQuestionAppearance(presentation.appearance, resolvedMode) === "dark"
      ? darkColors
      : lightColors;
  const openCitation = useOpenQuestionCitation(presentation);
  useEffect(() => {
    if (paramValue(params.questionPresentationId) !== presentation.id)
      router.setParams({ questionPresentationId: presentation.id });
  }, [params.questionPresentationId, presentation.id, router]);
  const chat = useBookChat({
    bookId,
    conversationId: presentation.conversationId,
    bookTitleParam: presentation.title,
    selectionQuote: presentation.selectionQuote,
    initialQuestion: presentation.initialQuestion,
    readingPosition: presentation.origin
      ? JSON.stringify(presentation.origin)
      : undefined,
    presentation,
  });

  const renderSheet = ({
    content,
    composer,
  }: {
    content: ReactNode;
    composer?: ReactNode;
  }) => (
    <ChatSheet
      title={chat.title}
      palette={palette}
      topInset={insets.top}
      bottomInset={insets.bottom}
      initialDetent={presentation.getSnapshot().sheetDetent}
      onDetentChange={(index) =>
        presentation.update({ sheetDetent: index }, false)
      }
      onClose={() => router.back()}
      footer={composer}
    >
      {content}
    </ChatSheet>
  );
  return (
    <ScopedTheme
      theme={resolveQuestionAppearance(presentation.appearance, resolvedMode)}
    >
      <ReaderAssistantThread
        chat={chat}
        palette={palette}
        presentation={presentation}
        renderContainer={renderSheet}
        onOpenCitation={openCitation}
        onOpenSettings={() => router.push("/book-chat/ai-settings")}
      />
    </ScopedTheme>
  );
}
