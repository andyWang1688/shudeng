/**
 * 版本化 Anchor（V3）：跨 EPUB / PDF 引擎的统一锚点描述。
 *
 * 设计目标：
 * - 旧 Swift 数据（Readium Locator JSON / PDF page+rect）经迁移后存为 V3；
 * - 保留原始 locator 副本（legacy.raw），不可转换项不会静默丢失；
 * - 新引擎只需产出 V3，不再直接消费某一家阅读器的定位格式。
 *
 * 存储：`anchors.locator_json` = JSON.stringify(AnchorV3)，`anchors.anchor_version` = 3。
 * `kind` 与 `anchors.engine` 对应：readium / offset / cfi / pdf。
 */
export const ANCHOR_SCHEMA = 'shudeng.anchor.v3' as const;
export const ANCHOR_VERSION = 3 as const;

export type AnchorKind = 'readium' | 'offset' | 'cfi' | 'pdf';

/** 原始定位格式副本，便于回滚/审计（迁移绝不修改输入）。 */
export interface AnchorLegacyCopy {
  /** 例：readium-locator-json / pdf-page-rect-json。 */
  readonly format: string;
  readonly raw: string;
}

export interface ReadiumTextQuote {
  readonly before?: string;
  readonly highlight?: string;
  readonly after?: string;
}

export interface ReadiumDomPosition {
  readonly charOffset?: number;
  readonly cssSelector?: string;
  readonly textNodeIndex?: number;
}

export interface ReadiumDomRange {
  readonly start?: ReadiumDomPosition;
  readonly end?: ReadiumDomPosition;
}

export interface ReadiumLocations {
  readonly cssSelector?: string;
  readonly domRange?: ReadiumDomRange;
  readonly position?: number;
  readonly progression?: number;
  readonly totalProgression?: number;
  readonly fragments?: ReadonlyArray<string>;
  readonly page?: number;
  readonly cfi?: string;
}

export interface ReadiumLocator {
  readonly href: string;
  readonly type?: string;
  readonly title?: string;
  readonly locations?: ReadiumLocations;
  readonly text?: ReadiumTextQuote;
}

/** 文本节点偏移锚（EPUB domRange 可转换时优先用这个，回跳最精确）。 */
export interface OffsetLocator {
  readonly href: string;
  readonly cssSelector?: string;
  readonly textNodeIndex?: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

/** EPUB CFI 锚（旧数据样本未出现，但新导出格式可能带）。 */
export interface CfiLocator {
  readonly cfi: string;
  readonly href?: string;
  readonly selection?: ReadiumLocator;
  readonly chapter?: string;
  readonly totalProgression?: number;
  readonly position?: number;
}

/** PDF 页内归一化矩形（相对 cropBox，0..1，原点左下，PDF 坐标）。 */
export interface PdfNormRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PdfLocator {
  /** 1-based 页码。 */
  readonly page: number;
  readonly pageCount?: number;
  /** 多行选区归一化矩形；旧数据没有几何时为空数组。 */
  readonly rects: ReadonlyArray<PdfNormRect>;
}

interface AnchorBase {
  readonly schema: typeof ANCHOR_SCHEMA;
  readonly version: typeof ANCHOR_VERSION;
  /** Readium 原始快照（若来源是 Readium locator）。 */
  readonly readium?: ReadiumLocator;
  /** 原始 locator JSON 副本。 */
  readonly legacy?: AnchorLegacyCopy;
}

export interface ReadiumAnchorV3 extends AnchorBase {
  readonly kind: 'readium';
  readonly locator: ReadiumLocator;
}

export interface OffsetAnchorV3 extends AnchorBase {
  readonly kind: 'offset';
  readonly locator: OffsetLocator;
  readonly readium: ReadiumLocator;
}

export interface CfiAnchorV3 extends AnchorBase {
  readonly kind: 'cfi';
  readonly locator: CfiLocator;
}

export interface PdfAnchorV3 extends AnchorBase {
  readonly kind: 'pdf';
  readonly locator: PdfLocator;
  readonly readium: ReadiumLocator;
}

export type AnchorV3 = ReadiumAnchorV3 | OffsetAnchorV3 | CfiAnchorV3 | PdfAnchorV3;

/** 结构校验（用于读取已迁移数据；不抛异常）。 */
export function isAnchorV3(value: unknown): value is AnchorV3 {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schema === ANCHOR_SCHEMA && record.version === ANCHOR_VERSION && typeof record.kind === 'string';
}
