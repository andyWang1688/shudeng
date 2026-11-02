/** 书灯设计令牌：对齐 docs/design/ui-development-standard.md 与 design-baseline 截图。 */
export const colors = {
  paper: '#FCFBF8',
  surface: '#FFFFFF',
  paperDeep: '#F2F0E9',
  line: '#E6E3DA',
  ink: '#282B26',
  ink2: '#64675F',
  ink3: '#696C63',
  lamp: '#8A590D',
  lampWash: '#F5E9CC',
  selection: '#F4E3AC',
  danger: '#A13C30',
  dangerWash: '#FAEBE7',
  green: '#4F5A4A',
  olive: '#E8E5D8',
} as const;

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32 } as const;
export const radius = { coverLeft: 3, coverRight: 7, field: 12, card: 16, sheet: 23 } as const;
export const type = {
  brand: 21,
  title: 31,
  section: 18,
  bookTitle: 21,
  body: 15,
  caption: 12,
  tiny: 10,
} as const;

export const font = {
  system: undefined as string | undefined,
  serif: 'Songti SC',
} as const;
