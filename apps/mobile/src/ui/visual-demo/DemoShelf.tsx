import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ArrowDownWideNarrow, Plus } from "lucide-react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { DemoEmpty, DemoHeading, DemoSearch } from "./DemoChrome";
import { demoBooks, type DemoBook } from "./demoBooks";
import { demoColors as c } from "./demoTheme";

/** One editorial direction; independent of the real library and importer. */
export function DemoShelf({
  onOpenBook,
}: {
  onOpenBook: (title: string) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(false);
  const [importHint, setImportHint] = useState(false);
  const columns = fontScale > 1.4 || width < 340 ? 1 : width > 680 ? 3 : 2;
  const bookWidth = (Math.min(width, 900) - 48 - (columns - 1) * 26) / columns;
  const books = demoBooks.filter((book) =>
    (book.title + book.author + book.format)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  if (sort) books.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  return (
    <View style={s.screen}>
      <DemoHeading
        title="书架"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="导入书籍"
            onPress={() => setImportHint(!importHint)}
            style={({ pressed }) => [s.add, pressed && s.pressed]}
          >
            <Plus size={25} color={c.ink} strokeWidth={1.7} />
          </Pressable>
        }
      />
      <DemoSearch
        value={query}
        onChange={setQuery}
        placeholder="搜索书名或作者"
      />
      {importHint && (
        <Text accessibilityLiveRegion="polite" style={s.hint}>
          设计预览仅使用示例书籍
        </Text>
      )}
      <ScrollView
        bounces
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.content}
      >
        <View style={s.section}>
          <Text style={s.count}>{books.length} 本</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="切换书籍排序"
            onPress={() => setSort(!sort)}
            style={s.sort}
          >
            <Text style={s.sortText}>{sort ? "书名" : "最近阅读"}</Text>
            <ArrowDownWideNarrow size={16} color={c.secondary} />
          </Pressable>
        </View>
        <View style={s.grid}>
          {books.map((book) => (
            <Pressable
              key={book.id}
              accessibilityRole="button"
              accessibilityLabel={"打开" + book.title}
              onPress={() => onOpenBook(book.title)}
              style={({ pressed }) => [
                s.book,
                { width: bookWidth },
                pressed && s.pressed,
              ]}
            >
              <DemoBookCover book={book} />
              <Text style={s.bookTitle}>{book.title}</Text>
              <View style={s.bookMeta}>
                <Text style={s.author}>{book.author}</Text>
                <Text style={s.progress}>
                  {book.format === "PDF"
                    ? "PDF"
                    : book.progress
                      ? book.progress + "%"
                      : "未读"}
                </Text>
              </View>
              {book.progress > 0 && (
                <View style={s.track}>
                  <View
                    style={[
                      s.fill,
                      {
                        width: (bookWidth * book.progress) / 100,
                        backgroundColor: book.color,
                      },
                    ]}
                  />
                </View>
              )}
            </Pressable>
          ))}
        </View>
        {!books.length && <DemoEmpty query={query} />}
      </ScrollView>
    </View>
  );
}

export function DemoBookCover({
  book,
  miniature = false,
}: {
  book: DemoBook;
  miniature?: boolean;
}) {
  if (miniature)
    return (
      <View
        accessible={false}
        style={[s.mini, { backgroundColor: book.color }]}
      >
        <View style={[s.miniLine, { backgroundColor: book.ink }]} />
      </View>
    );
  return (
    <View style={[s.coverShadow, { backgroundColor: book.color }]}>
      <View style={[s.cover, { backgroundColor: book.color }]}>
        <View style={s.spine} />
        <Text
          allowFontScaling={false}
          style={[s.coverEnglish, { color: book.ink }]}
        >
          {book.english}
        </Text>
        <Text
          allowFontScaling={false}
          style={[s.coverTitle, { color: book.ink }]}
        >
          {book.id === "river"
            ? "额尔古纳\n河右岸"
            : book.id === "moon"
              ? "月亮与\n六便士"
              : book.title}
        </Text>
        <View style={s.art} accessible={false}>
          <Svg width="100%" height="100%" viewBox="0 0 160 122">
            {book.id === "river" ? (
              <Path
                d="M130 -15 C30 18 145 35 62 63 S120 96 24 140 M144 -15 C44 18 159 35 76 63 S134 96 38 140 M158 -15 C58 18 173 35 90 63 S148 96 52 140"
                stroke={book.ink}
                strokeWidth="1.2"
                opacity="0.55"
                fill="none"
              />
            ) : book.id === "moon" ? (
              <>
                <Circle cx="107" cy="39" r="34" fill={book.ink} opacity="0.9" />
                <Path
                  d="M0 118 L48 68 L82 96 L119 76 L160 120"
                  fill={book.ink}
                  opacity="0.22"
                />
              </>
            ) : book.id === "walden" ? (
              <>
                <Path
                  d="M0 67 L45 20 L72 49 L110 8 L160 67 Z"
                  fill={book.ink}
                  opacity="0.18"
                />
                <Path
                  d="M0 77 Q40 66 80 77 T160 77 M4 89 Q40 79 80 89 T156 89 M18 101 Q49 93 80 101 T142 101 M35 112 Q55 106 80 112 T125 112"
                  stroke={book.ink}
                  strokeWidth="1"
                  fill="none"
                  opacity="0.65"
                />
              </>
            ) : (
              <>
                <Circle
                  cx="80"
                  cy="47"
                  r="33"
                  stroke={book.ink}
                  strokeWidth="1"
                  fill="none"
                />
                <Path
                  d="M0 86 Q40 74 80 86 T160 86 M0 98 Q40 86 80 98 T160 98 M0 110 Q40 98 80 110 T160 110"
                  stroke={book.ink}
                  strokeWidth="1"
                  fill="none"
                  opacity="0.6"
                />
              </>
            )}
          </Svg>
        </View>
        <Text
          allowFontScaling={false}
          style={[s.coverAuthor, { color: book.ink }]}
        >
          {book.author}
        </Text>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 30,
    maxWidth: 900,
    width: "100%",
    alignSelf: "center",
  },
  add: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -8,
  },
  pressed: { opacity: 0.65 },
  hint: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    color: c.secondary,
    fontSize: 14,
  },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  count: { fontSize: 13, lineHeight: 20, color: c.muted },
  sort: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7 },
  sortText: { fontSize: 13, color: c.secondary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 26, rowGap: 30 },
  book: { alignSelf: "flex-start" },
  coverShadow: {
    borderRadius: 3,
    shadowColor: "#30291C",
    shadowOffset: { width: 1, height: 5 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
    elevation: 3,
  },
  cover: {
    aspectRatio: 0.72,
    overflow: "hidden",
    borderRadius: 3,
    paddingHorizontal: 17,
    paddingTop: 19,
    paddingBottom: 14,
    justifyContent: "space-between",
  },
  spine: {
    position: "absolute",
    left: 5,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "#FFFFFF",
    opacity: 0.2,
  },
  coverEnglish: {
    fontSize: 8,
    fontWeight: "500",
    lineHeight: 11,
    letterSpacing: 1.3,
  },
  coverTitle: {
    position: "absolute",
    left: 17,
    right: 10,
    top: 46,
    fontFamily: "Songti SC",
    fontSize: 25,
    lineHeight: 31,
    zIndex: 1,
  },
  coverAuthor: {
    position: "absolute",
    left: 17,
    bottom: 14,
    fontSize: 10,
    lineHeight: 15,
  },
  art: { position: "absolute", bottom: 22, left: 0, right: 0, height: "49%" },
  bookTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "500",
    color: c.ink,
    marginTop: 15,
  },
  bookMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 5,
    marginTop: 5,
  },
  author: { color: c.secondary, fontSize: 13, lineHeight: 19 },
  progress: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 19,
    fontVariant: ["tabular-nums"],
  },
  track: { height: 2, backgroundColor: c.line, marginTop: 10, borderRadius: 1 },
  fill: { height: 2, borderRadius: 1 },
  mini: {
    width: 36,
    height: 48,
    borderRadius: 2,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  miniLine: { height: 1, opacity: 0.7 },
});
