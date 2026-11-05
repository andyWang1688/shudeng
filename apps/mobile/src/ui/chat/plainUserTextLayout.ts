import type { CommittedTextMeasure, PlainTextTypography } from '../../platform/text/textMetricsState';

/** User-message policy stays in TS; the platform measures content only. */
export function usesPlainUserTextMetrics(platform: string, attached: boolean) {
  return platform === 'ios' && !attached;
}
export function plainUserTextContentCap(rowWidth: number) {
  const cap = Math.min(rowWidth * 0.88, rowWidth - 28) - 24;
  return Number.isFinite(cap) && cap > 0 ? cap : undefined;
}
export function plainUserTextBubbleWidth(rowWidth: number, preferredWidth: number, scale: number) {
  return Math.min(Math.min(rowWidth * 0.88, rowWidth - 28), Math.ceil((preferredWidth + 24) * scale) / scale);
}

export const plainUserTextTypography: PlainTextTypography = {
  face: { kind: 'system', weight: 'regular' }, basePointSize: 15, metricsStyle: 'body', lineSpacing: 4,
};
export type PlainUserTextLayout = Readonly<{
  key: string; width: number; minimumHeight: number; measurement: CommittedTextMeasure;
}>;
export const plainUserTextKey = (text: string, rowWidth: number) => JSON.stringify([text, rowWidth]);
export const plainPreparationKey = (texts: readonly string[], rowWidth: number) => JSON.stringify([rowWidth, texts]);
