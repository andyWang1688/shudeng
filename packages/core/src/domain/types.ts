/** 书灯共享领域类型：不依赖 React Native / Node 专属实现。 */
export type BookFormat = 'epub' | 'pdf';

export interface BookIdentity {
  id: string;
  title: string;
  format: BookFormat;
  sourceHash: string;
}

export interface EvidenceRef {
  id: string;
  quote: string;
  chapter?: string;
  page?: number;
}

export interface Citation extends EvidenceRef {
  locator: string;
}

export interface AgentQuestion {
  book: BookIdentity;
  question: string;
  selection?: string;
  history?: ReadonlyArray<{ question: string; answer: string }>;
}
