import type { AgentSentMaterial, LegacyNativeEvidence, LegacyNativeSnapshot } from '@shudeng/core';

/** Display sources stay distinct: a legacy evidence registry is not a dispatched payload. */
export type QuestionMaterials =
  | Readonly<{ kind: 'sent'; values: readonly AgentSentMaterial[] }>
  | Readonly<{ kind: 'legacy-evidence'; values: readonly LegacyNativeEvidence[] }>;

export function questionMaterials(value: {
  readonly sentMaterials?: readonly AgentSentMaterial[];
  readonly legacyNative?: LegacyNativeSnapshot;
}): QuestionMaterials | undefined {
  if (value.sentMaterials !== undefined) return { kind: 'sent', values: value.sentMaterials };
  if (value.legacyNative?.evidence !== undefined) return { kind: 'legacy-evidence', values: value.legacyNative.evidence };
  return;
}

/** ReadingQuestion.locationTitle: Readium PDF fragment page precedes explicit page/position. */
export function legacyMaterialLocationTitle(value: LegacyNativeEvidence): string {
  try {
    const locator: unknown = JSON.parse(value.locatorJSON);
    if (typeof locator !== 'object' || locator === null || Array.isArray(locator)) return value.chapter ?? '原文';
    const record = locator as Record<string, unknown>;
    if (record.type !== 'application/pdf' && record.type !== 'pdf') return value.chapter ?? '原文';
    const locations = typeof record.locations === 'object' && record.locations !== null && !Array.isArray(record.locations)
      ? record.locations as Record<string, unknown> : {};
    const fragment = Array.isArray(locations.fragments) ? locations.fragments.find((item): item is string =>
      typeof item === 'string' && /^page=\d+$/.test(item)) : undefined;
    const page = fragment ? Number(fragment.slice(5)) : locations.page ?? locations.position ?? record.page;
    if (typeof page === 'number' && Number.isSafeInteger(page) && page >= 1) return `第 ${page} 页`;
  } catch { /* Invalid locations retain the saved chapter title; they never become a jump action. */ }
  return value.chapter ?? '原文';
}
