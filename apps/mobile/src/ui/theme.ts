/**
 * 书灯设计令牌：对齐 docs/design/ui-development-standard.md、Swift BookDesign 与 design-baseline。
 * `colors` 保留浅色静态导出给旧页面；根四栏用 `usePalette()` 跟随系统深色。
 */
import { useColorScheme } from 'react-native';

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
