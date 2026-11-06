import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SymbolView } from "expo-symbols";
import Svg, { Circle, Path } from "react-native-svg";
import { demoColors } from "./demoTheme";

export interface DemoShelfBook {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly progress: number;
}

const BOOKS = [
  {
    id: "river",
    title: "额尔古纳河右岸",
    author: "迟子建",
    progress: 38,
    background: "#334D40",
    ink: "#F3EBD7",
    english: "THE RIGHT BANK",
    motif: "river",
  },
  {
    id: "moon",
    title: "月亮与六便士",
    author: "威廉·萨默塞特·毛姆",
    progress: 12,
    background: "#A65F46",
    ink: "#F7EADB",
    english: "THE MOON AND SIXPENCE",
    motif: "moon",
  },
  {
    id: "walden",
    title: "瓦尔登湖",
    author: "亨利·戴维·梭罗",
    progress: 0,
    background: "#EAE3D1",
    ink: "#435748",
    english: "WALDEN",
    motif: "lake",
  },
  {
    id: "siddhartha",
    title: "悉达多",
    author: "赫尔曼·黑塞",
    progress: 0,
    background: "#53616D",
    ink: "#F1EADB",
    english: "SIDDHARTHA",
    motif: "sun",
  },
] as const;

type Props = {
  readonly onOpenBook: (bookTitle?: string) => void;
  readonly onImport?: () => void;
};

/** A visual-only shelf. All content is local sample data; no library API is used. */
export function DemoShelf({ onOpenBook, onImport }: Props) {
  const palette = demoColors;
  const styles = useMemo(() => createStyles(palette), []);
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [sortByTitle, setSortByTitle] = useState(false);
  const [importHint, setImportHint] = useState(false);
  const cardWidth = (width - 48 - 22) / 2;
  const books = BOOKS.filter((book) =>
    (book.title + book.author).includes(query.trim()),
  );
  if (sortByTitle)
    books.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          书架
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="导入书籍"
          onPress={() => {
            if (onImport) onImport();
            else setImportHint((value) => !value);
          }}
          style={({ pressed }) => [styles.import, pressed && styles.pressed]}
        >
          <SymbolView
            name="plus"
            size={22}
            weight="medium"
            tintColor={palette.accent}
          />
        </Pressable>
      </View>
      <View style={styles.search}>
        <SymbolView
          name="magnifyingglass"
          size={17}
          tintColor={palette.muted}
        />
        <TextInput
          accessibilityLabel="搜索示例书籍"
          placeholder="书名或作者"
          placeholderTextColor={palette.muted}
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>
      {importHint ? (
        <Text style={styles.hint}>这是设计预览，书籍为示例内容。</Text>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.count}>{books.length} 本书</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="切换书籍排序"
          onPress={() => setSortByTitle((value) => !value)}
          style={styles.sort}
        >
          <Text style={styles.sortText}>
            {sortByTitle ? "书名排序" : "最近阅读"}
          </Text>
          <SymbolView
            name="chevron.down"
            size={10}
            weight="medium"
            tintColor={palette.muted}
          />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {books.map((book) => (
          <Pressable
            key={book.id}
            accessibilityRole="button"
            accessibilityLabel={"打开" + book.title}
            onPress={() => onOpenBook(book.title)}
            style={({ pressed }) => [
              styles.book,
              { width: cardWidth },
              pressed && styles.pressed,
            ]}
          >
            <View
              style={[styles.coverShadow, { backgroundColor: book.background }]}
            >
              <View
                style={[
                  styles.cover,
                  {
                    height: cardWidth * 1.42,
                    backgroundColor: book.background,
                  },
                ]}
              >
                <View style={styles.spine} />
                <Text style={[styles.coverEnglish, { color: book.ink }]}>
                  {book.english}
                </Text>
                <Text style={[styles.coverTitle, { color: book.ink }]}>
                  {book.title}
                </Text>
                <Text style={[styles.coverAuthor, { color: book.ink }]}>
                  {book.author}
                </Text>
                <View style={styles.motif}>
                  <Svg width="100%" height="100%" viewBox="0 0 150 112">
                    {book.motif === "river" ? (
                      <Path
                        d="M123 -5 C40 8 130 29 56 51 S107 73 22 119 M132 -5 C49 8 139 29 65 51 S116 73 31 119 M141 -5 C58 8 148 29 74 51 S125 73 40 119"
                        stroke={book.ink}
                        strokeWidth="1.1"
                        opacity="0.5"
                        fill="none"
                      />
                    ) : book.motif === "moon" ? (
                      <>
                        <Circle
                          cx="103"
                          cy="32"
                          r="21"
                          fill={book.ink}
                          opacity="0.8"
                        />
                        <Path
                          d="M13 110 L50 62 L74 86 L104 54 L144 110 M12 110 H145"
                          stroke={book.ink}
                          strokeWidth="1.1"
                          opacity="0.65"
                          fill="none"
                        />
                      </>
                    ) : book.motif === "lake" ? (
                      <Path
                        d="M5 64 Q40 56 75 64 T145 64 M13 75 Q43 68 75 75 T137 75 M28 86 Q50 81 75 86 T123 86 M5 51 L34 30 L57 45 L95 18 L144 51"
                        stroke={book.ink}
                        strokeWidth="1.1"
                        opacity="0.6"
                        fill="none"
                      />
                    ) : (
                      <>
                        <Circle
                          cx="75"
                          cy="47"
                          r="26"
                          stroke={book.ink}
                          strokeWidth="1"
                          fill="none"
                          opacity="0.7"
                        />
                        <Path
                          d="M5 78 H145 M20 87 H130 M37 96 H113"
                          stroke={book.ink}
                          strokeWidth="1.1"
                          opacity="0.65"
                        />
                      </>
                    )}
                  </Svg>
                </View>
                <Text style={[styles.imprint, { color: book.ink }]}>
                  书 灯 · 阅 读 藏 本
                </Text>
              </View>
            </View>
            <Text style={styles.bookTitle} numberOfLines={2}>
              {book.title}
            </Text>
            <Text style={styles.bookAuthor} numberOfLines={1}>
              {book.author}
            </Text>
            <View style={styles.progressRow}>
              {book.progress > 0 ? (
                <View
                  style={[
                    styles.progressDot,
                    { backgroundColor: palette.accent },
                  ]}
                />
              ) : null}
              <Text
                style={[
                  styles.progress,
                  book.progress > 0 && { color: palette.accent },
                ]}
              >
                {book.progress > 0 ? "已读 " + book.progress + "%" : "未开始"}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      {books.length === 0 ? (
        <Text style={styles.empty}>没有找到这本书，换个词试试。</Text>
      ) : null}
    </ScrollView>
  );
}

function createStyles(palette: typeof demoColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.paper },
    content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
    heading: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 23,
    },
    title: {
      fontSize: 32,
      lineHeight: 40,
      fontWeight: "700",
      letterSpacing: -0.8,
      color: palette.ink,
    },
    import: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: palette.accentWash,
      alignItems: "center",
      justifyContent: "center",
    },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      backgroundColor: palette.tint,
      borderRadius: 12,
      paddingHorizontal: 14,
      minHeight: 46,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      minHeight: 46,
      color: palette.ink,
      paddingVertical: 10,
    },
    hint: { fontSize: 12, lineHeight: 18, color: palette.muted, marginTop: 10 },
    section: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 21,
      marginBottom: 14,
    },
    count: { fontSize: 12, lineHeight: 18, color: palette.muted },
    sort: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5 },
    sortText: { fontSize: 12, lineHeight: 18, color: palette.muted },
    grid: { flexDirection: "row", flexWrap: "wrap", columnGap: 22, rowGap: 27 },
    book: { alignSelf: "flex-start" },
    coverShadow: {
      borderRadius: 3,
      shadowColor: "#19271D",
      shadowOffset: { width: 2, height: 5 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 3,
    },
    cover: {
      borderRadius: 3,
      overflow: "hidden",
      paddingTop: 17,
      paddingHorizontal: 16,
    },
    spine: {
      position: "absolute",
      left: 4,
      top: 0,
      bottom: 0,
      width: 3,
      backgroundColor: "#000000",
      opacity: 0.1,
    },
    coverEnglish: {
      fontSize: 6.5,
      lineHeight: 10,
      letterSpacing: 1.1,
      opacity: 0.7,
    },
    coverTitle: {
      fontFamily: "Songti SC",
      fontWeight: "600",
      fontSize: 22,
      lineHeight: 29,
      marginTop: 15,
    },
    coverAuthor: { fontSize: 8, lineHeight: 13, opacity: 0.8, marginTop: 9 },
    motif: {
      position: "absolute",
      left: 12,
      right: 12,
      bottom: 26,
      height: 68,
    },
    imprint: {
      position: "absolute",
      bottom: 14,
      alignSelf: "center",
      fontSize: 6,
      letterSpacing: 1,
      opacity: 0.75,
    },
    bookTitle: {
      fontSize: 16,
      lineHeight: 23,
      fontWeight: "600",
      color: palette.ink,
      marginTop: 13,
    },
    bookAuthor: {
      fontSize: 12,
      lineHeight: 18,
      color: palette.muted,
      marginTop: 3,
    },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: 5,
    },
    progressDot: { width: 4, height: 4, borderRadius: 2 },
    progress: { fontSize: 11, lineHeight: 17, color: palette.muted },
    pressed: { opacity: 0.72 },
    empty: {
      color: palette.muted,
      fontSize: 14,
      lineHeight: 22,
      paddingVertical: 40,
      textAlign: "center",
    },
  });
}
