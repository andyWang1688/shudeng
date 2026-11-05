import type { LegacyNativeSnapshot } from '@shudeng/core';
import { trimNativeWhitespace } from './toolPresentation';

export interface QuestionSelection {
  readonly quote: string;
  readonly contextQuote: string;
  readonly attached: boolean;
}

/** Current fields, including empty strings/false, are authoritative over a historical snapshot. */
export function questionSelection(value: {
  readonly selectionQuote?: string;
  readonly selectionContextQuote?: string;
  readonly selectionAttached?: boolean;
  readonly legacyNative?: LegacyNativeSnapshot;
}): QuestionSelection | undefined {
  if (value.selectionQuote !== undefined || value.selectionContextQuote !== undefined || value.selectionAttached !== undefined) {
    const quote = value.selectionQuote ?? '';
    return { quote, contextQuote: value.selectionContextQuote ?? quote, attached: value.selectionAttached ?? quote.length > 0 };
  }
  const legacy = value.legacyNative;
  if (!legacy || (legacy.selectionParts === undefined && legacy.selection === undefined && legacy.freeQuestion === undefined)) return;
  const parts = legacy.selectionParts ?? (legacy.selection ? [legacy.selection] : []);
  return {
    quote: parts.map(part => part.quote ?? '').join('\n'),
    contextQuote: parts.map(part => part.quote ?? '').filter(quote => trimNativeWhitespace(quote).length > 0).join('\n---\n'),
    attached: legacy.freeQuestion !== true,
  };
}

export function selectionFields(value: QuestionSelection | undefined): {
  selectionQuote?: string; selectionContextQuote?: string; selectionAttached?: boolean;
} {
  return value ? { selectionQuote: value.quote, selectionContextQuote: value.contextQuote, selectionAttached: value.attached } : {};
}
