/**
 * Product tokens follow the approved UI demo, with semantic dark-mode equivalents.
 * `colors` 保留浅色静态导出给旧页面；产品页面用 `usePalette()` 跟随外观。
 */
import { useColorScheme } from "react-native";
import { useAppearanceMode } from "./appearance";

export const lightColors = {
  paper: "#FAF9F6",
  paperDeep: "#F0EDE7",
  surface: "#FFFFFF",
  ink: "#292722",
  ink2: "#625E56",
  ink3: "#777168",
  line: "#E4E0D8",
  lamp: "#805638",
  lampInk: "#805638",
  lampWash: "#EDE4D9",
  selection: "#F2DBA6",
  error: "#A63A2B",
  errorWash: "#F8E7E1",
  danger: "#A63A2B",
  dangerWash: "#F8E7E1",
  green: "#4F5A4A",
  olive: "#E8E5D8",
} as const;

export const darkColors: Palette = {
  paper: "#1B1A17",
  paperDeep: "#24221E",
  surface: "#2A2723",
  ink: "#F3EEE3",
  ink2: "#C3BCAE",
  ink3: "#948D80",
  line: "#3A362F",
  lamp: "#E0AE6A",
  lampInk: "#F0C98B",
  lampWash: "#3A2F1F",
  selection: "#5A4A2A",
  error: "#F0A79A",
  errorWash: "#3A2823",
  danger: "#F0A79A",
  dangerWash: "#3A2823",
  green: "#46503F",
  olive: "#3A362F",
} as const;

export type Palette = { readonly [K in keyof typeof lightColors]: string };

/** 保留给尚未迁移的消费者；当前产品页面使用 usePalette。 */
export const colors: Palette = lightColors;

export function usePalette(): Palette {
  const mode = useAppearanceMode();
  const systemScheme = useColorScheme();
  const dark = mode === "system" ? systemScheme === "dark" : mode === "dark";
  return dark ? darkColors : lightColors;
}

/** 页面左右边距 24pt；底栏 56pt 加设备实际底部安全区。 */
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  screen: 24,
  bottomBar: 81,
  bottomBarRow: 56,
  bottomBarGap: 25,
} as const;

export const radius = {
  cover: 4,
  field: 12,
  card: 16,
  sheet: 23,
  pill: 999,
  round: 22,
} as const;

export const type = {
  display: 30,
  brand: 21,
  title: 31,
  section: 18,
  bookTitle: 21,
  body: 15,
  subhead: 13,
  footnote: 12,
  caption: 12,
  captionSmall: 10.5,
  tiny: 10.5,
} as const;

export const font = {
  system: undefined as string | undefined,
  serif: "Songti SC",
} as const;

export type BookCoverTone = {
  readonly background: string;
  readonly ink: string;
  readonly rule: string;
};

/** Matches Swift's title.utf8 byte sum, including non-BMP titles, without a Node/TextEncoder dependency. */
function titlePaletteIndex(title: string): number {
  let sum = 0;
  for (const character of title) {
    let point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    const bytes =
      point < 0x80
        ? [point]
        : point < 0x800
          ? [0xc0 | (point >> 6), 0x80 | (point & 0x3f)]
          : point < 0x10000
            ? [
                0xe0 | (point >> 12),
                0x80 | ((point >> 6) & 0x3f),
                0x80 | (point & 0x3f),
              ]
            : [
                0xf0 | (point >> 18),
                0x80 | ((point >> 12) & 0x3f),
                0x80 | ((point >> 6) & 0x3f),
                0x80 | (point & 0x3f),
              ];
    for (const byte of bytes) sum = (sum + byte) % 4;
  }
  return sum;
}

/** Generic fallback used only when the publication has no embedded cover. */
export function bookCoverTone(title: string, _format?: string): BookCoverTone {
  const groups = [
    ["#F0E5CE", "#3B332A"],
    ["#38483F", "#F1EAD9"],
    ["#8F5336", "#F7EBDF"],
    ["#3A4653", "#EFF0E8"],
  ] as const;
  const [background, ink] = groups[titlePaletteIndex(title)]!;
  return { background, ink, rule: `${ink}66` };
}

export function bookSwatchTone(title: string, _format?: string): BookCoverTone {
  const background = ["#38483F", "#8F5336", "#3A4653", "#6D5A3A"][
    titlePaletteIndex(title)
  ]!;
  return { background, ink: lightColors.paper, rule: `${lightColors.paper}66` };
}
