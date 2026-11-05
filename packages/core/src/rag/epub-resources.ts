import type { CancellationSignal } from './types.js';

/** ZIP metadata is a hint. The platform must count actual inflated bytes and verify CRC. */
export interface EpubResourceEntry {
  readonly path: string;
  readonly resourceID: string;
  readonly size: number;
}

/** Safe to pass into the reader. Never includes local URLs or publication bytes. */
export interface EpubArchiveDescriptor {
  readonly sessionID: string;
  readonly resourceBaseURL: string;
  readonly entries: readonly EpubResourceEntry[];
}

export interface EpubResourceOptions { readonly signal?: CancellationSignal }

/** One owned temporary file. A consumer must release it, including when copy/render fails. */
export interface EpubResourceLease {
  readonly uri: string;
  readonly bytes: number;
  release(): Promise<void>;
}

export interface EpubCoverResource {
  readonly href: string;
  readonly mediaType: string;
  readonly extension: 'jpg' | 'png' | 'svg' | 'webp';
}

/** Each import/index/cover/reader consumer owns a separate session. close is idempotent,
 * cancels and joins pending reads, releases descriptors and removes temporary leases. */
export interface EpubResourceArchive {
  readonly entries: readonly EpubResourceEntry[];
  getSize(path: string): number;
  readText(path: string, options?: EpubResourceOptions): Promise<string | null>;
  materialize(path: string, options?: EpubResourceOptions): Promise<EpubResourceLease | null>;
  close(): Promise<void>;
}
