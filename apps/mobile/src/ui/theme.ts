/** 纸白/暖灯基础色（只取少量令牌，避免复制 Swift 版 UI 细节）。 */
export const colors = {
  paper: '#F7F3EA',
  paperDeep: '#EDE6D8',
  surface: '#FFFDF8',
  ink: '#24211C',
  ink2: '#6E6A60',
  ink3: '#948D80',
  line: '#DED5C4',
  lamp: '#C98A2E',
  lampWash: '#F4E3C2',
  danger: '#A63A2B',
} as const;

export const spacing = { xs: 8, sm: 12, md: 16, lg: 24 } as const;
export const radius = { field: 10, card: 16 } as const;
