import { useMemo } from 'react';
import { View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChatComposer, ChatList, ChatLoadingState, ChatSheet, useBookChat } from '../src/ui/chat';
import { darkColors, lightColors, type Palette } from '../src/ui/theme';

function paramValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** 书内 AI 问答：只做路由/主题/Sheet 编排；数据在 useBookChat，视图在 src/ui/chat。 */
export default function BookChatRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const systemScheme = useColorScheme();
  const params = useLocalSearchParams<{
    bookId?: string | string[];
    bookTitle?: string | string[];
    selectionQuote?: string | string[];
    locator?: string | string[];
    initialQuestion?: string | string[];
    /** 透明 modal 内 useColorScheme 可能读不到下层 scheme；由入口显式传 dark/light。 */
    theme?: string | string[];
  }>();
  const themeParam = paramValue(params.theme);
  const palette: Palette =
    themeParam === 'dark'
      ? darkColors
      : themeParam === 'light'
        ? lightColors
        : systemScheme === 'dark'
          ? darkColors
          : lightColors;
  const bookId = paramValue(params.bookId) ?? '';
  const chat = useBookChat({
    bookId,
    bookTitleParam: paramValue(params.bookTitle),
    selectionQuote: paramValue(params.selectionQuote),
    initialQuestion: paramValue(params.initialQuestion),
  });
  const sheetHeight = useMemo(() => Math.round(windowHeight * 0.76), [windowHeight]);

  return (
    <ChatSheet palette={palette} height={sheetHeight} bottomInset={insets.bottom} onClose={() => router.back()}>
      {chat.loading ? (
        <ChatLoadingState palette={palette} />
      ) : (
        <View style={{ flex: 1 }}>
          <ChatList
            turns={chat.turns}
            bookId={bookId}
            bookTitle={chat.title}
            format={chat.format}
            indexMissing={chat.indexMissing}
            loadError={chat.loadError}
            indexDetail={chat.indexDetail}
            onRetry={chat.retry}
            palette={palette}
          />
          <ChatComposer
            question={chat.question}
            onChangeQuestion={chat.setQuestion}
            placeholder={chat.placeholder}
            running={chat.running}
            canSend={chat.canSend}
            inputEnabled={Boolean(chat.availability?.book)}
            configMissing={chat.configMissing}
            selectionPending={chat.selectionPending}
            service={chat.service}
            turnsCount={chat.turns.length}
            onSend={() => void chat.send()}
            onCancel={chat.cancel}
            onOpenSettings={() => router.push('/ai-settings')}
            palette={palette}
          />
        </View>
      )}
    </ChatSheet>
  );
}
