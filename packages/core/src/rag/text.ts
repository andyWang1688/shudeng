/**
 * FTS5 中文/拉丁混合 token 化（写入索引与查询共用）。
 *
 * SQLite FTS5 的 unicode61 不支持中文分词：连续中文会被当成单个 token，
 * 因此这里把中文（CJK/假名/谚文）按**单字**拆开、拉丁/数字按词拆分，
 * 写入索引与构造 MATCH 查询都用同一套 token（AND 连接），实现中文子串级召回。
 * 代价：BM25 按字而非词排序，精度有限——V2 由向量相似度融合补足。
 */

const CJK_OR_WORD = /[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]|[A-Za-z0-9]+/g;

/** 文本 → token 数组（小写）。 */
export function ftsTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(CJK_OR_WORD)) {
    const value = match[0]?.toLowerCase();
    if (value) tokens.push(value);
  }
  return tokens;
}

/** 写入 FTS 列的 token 串。 */
export function ftsIndexText(text: string): string {
  return ftsTokens(text).join(' ');
}

function escapeToken(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

/** 查询文本 → FTS5 MATCH 表达式（各 token AND；空查询返回 null）。 */
export function ftsMatchQuery(query: string): string | null {
  const tokens = ftsTokens(query);
  if (!tokens.length) return null;
  return tokens.map(escapeToken).join(' AND ');
}
