/** Both values use percentage points of the body font size. */
export interface ReaderSpacing {
  readonly letterSpacing: number;
  readonly lineSpacing: number;
}

export const readerSpacingSettings = {
  letterSpacing: { min: -5, max: 10, step: 0.5, default: 0, compact: -2.5, loose: 7 },
  lineSpacing: { min: 100, max: 230, step: 5, default: 175, compact: 150, loose: 210 },
} as const;

export const defaultReaderSpacing: ReaderSpacing = {
  letterSpacing: readerSpacingSettings.letterSpacing.default,
  lineSpacing: readerSpacingSettings.lineSpacing.default,
};

export function normalizeReaderSpacing(field: keyof ReaderSpacing, value: unknown): number {
  const setting = readerSpacingSettings[field];
  if (value === 'compact' || value === 'loose') return setting[value];
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) return setting.default;
  const rounded = Math.round(number / setting.step) * setting.step;
  return Math.max(setting.min, Math.min(setting.max, rounded));
}
