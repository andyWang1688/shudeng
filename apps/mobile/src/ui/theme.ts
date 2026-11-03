/**
 * 书灯设计令牌：对齐 docs/design/ui-development-standard.md、Swift BookDesign 与 design-baseline。
 * `colors` 保留浅色静态导出给旧页面；根四栏用 `usePalette()` 跟随系统深色。
 */
import { useColorScheme, type ViewStyle } from 'react-native';

export const lightColors = {
  paper: '#FCFBF8',
  paperDeep: '#F2F0E9',
  surface: '#FFFFFF',
  ink: '#282B26',
  ink2: '#64675F',
  ink3: '#696C63',
  line: '#E6E3DA',
  lamp: '#B4712A',
  lampInk: '#8A5413',
  lampWash: '#F6E7CC',
  selection: '#F2DBA6',
  error: '#A13C30',
  errorWash: '#FAEBE7',
  danger: '#A13C30',
  dangerWash: '#FAEBE7',
  green: '#4F5A4A',
  olive: '#E8E5D8',
} as const;

export const darkColors: Palette = {
  paper: '#1B1A17',
  paperDeep: '#24221E',
  surface: '#2A2723',
  ink: '#F3EEE3',
  ink2: '#C3BCAE',
  ink3: '#948D80',
  line: '#3A362F',
  lamp: '#E0AE6A',
  lampInk: '#F0C98B',
  lampWash: '#3A2F1F',
  selection: '#5A4A2A',
  error: '#F0A79A',
  errorWash: '#3A2823',
  danger: '#F0A79A',
  dangerWash: '#3A2823',
  green: '#46503F',
  olive: '#3A362F',
} as const;

export type Palette = { readonly [K in keyof typeof lightColors]: string };

/** 旧页面（阅读器、问答等）仍用浅色静态令牌；逐页对齐的根四栏用 usePalette。 */
export const colors: Palette = lightColors;

export function usePalette(): Palette {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkColors : lightColors;
}

/** 页面左右边距 24pt（baseline 实测 x=24），底栏总高 81pt（56 + 25 底部留白）。 */
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
  serif: 'Songti SC',
} as const;


export type BookCoverTone = {
  readonly background: string;
  readonly ink: string;
  readonly rule: string;
};

/** 真实 Swift v0.4.8 书封：瓦尔登湖深墨绿、红楼梦纸黄、论语/段永平暖纸色。 */
export function bookCoverTone(title: string, format?: string): BookCoverTone {
  const name = title.trim();
  if (/瓦尔登湖/.test(name)) return { background: '#3F4C40', ink: '#F2EDE2', rule: 'rgba(242,237,226,0.45)' };
  if (/红楼梦|石头记/.test(name)) return { background: '#EFE4CC', ink: '#2C2A24', rule: 'rgba(44,42,36,0.38)' };
  if (/论语/.test(name)) return { background: '#D9D2C2', ink: '#2C2A24', rule: 'rgba(44,42,36,0.34)' };
  if (/段永平|大道|投资/.test(name) || format === 'pdf') return { background: '#E7DECB', ink: '#2C2A24', rule: 'rgba(44,42,36,0.34)' };
  const warm = ['#E8E1D2', '#DDD5C4', '#D6CDBA', '#E3D8C3'];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return { background: warm[hash % warm.length] ?? '#E8E1D2', ink: '#2C2A24', rule: 'rgba(44,42,36,0.34)' };
}

/** 真实原版列表左侧小书脊：EPUB 统一深墨绿，PDF/其他用书封暖色。 */
export function bookSwatchTone(title: string, format?: string): BookCoverTone {
  if (!format || format === 'epub') return { background: '#3F4C40', ink: '#EFE4CC', rule: 'rgba(239,228,204,0.4)' };
  return bookCoverTone(title, format);
}

/** 书架/笔记/对话统一搜索条：白色圆角立体条、细描边 + 轻微阴影。 */
export function searchFieldTextColor(palette: Palette): string {
  return palette.paper === darkColors.paper ? palette.ink : '#282B26';
}

export function searchFieldPlaceholderColor(palette: Palette): string {
  return palette.paper === darkColors.paper ? palette.ink3 : '#8A8375';
}

export function searchFieldIconColor(palette: Palette): string {
  return palette.paper === darkColors.paper ? palette.ink2 : '#57534A';
}

export function searchFieldChrome(palette: Palette): ViewStyle {
  const dark = palette.paper === darkColors.paper;
  return {
    backgroundColor: dark ? '#1F1D1A' : '#FFFFFF',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 15,
    shadowColor: '#000000',
    shadowOpacity: dark ? 0.12 : 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  };
}
