import { describe, expect, it } from 'vitest';
import { decodeReadCursor, passageSliceEnd, scanTextSelection } from './passage-window.js';

async function* parts<T>(values: ReadonlyArray<T>): AsyncGenerator<T> { yield* values; }

describe('source passage windows', () => {
  it('preserves raw UTF-16 offsets across normalization, gaps and reading-order keys', async () => {
    const first = '🪔前文。选', second = '中\n  原文。尾声。';
    const found = await scanTextSelection(parts([
      { key: 'z', text: first, offset: 50 },
      { key: 'a', text: second, offset: 50 + first.length },
    ]), { before: '前文。', highlight: '选中 原文。', after: '尾声。' });
    expect(found).toEqual({ key: 'z', offset: 50 + first.indexOf('选') });
    const relative = await scanTextSelection(parts([
      { key: 99, text: '不相关。' },
      { key: 1, text: '🪔选中内容', separatorBefore: ' ' },
    ]), { before: '不相关。 🪔', highlight: '选中内容' });
    expect(relative).toEqual({ key: 1, offset: 2 });
  });

  it('keeps context until a selection crossing a page boundary is complete', async () => {
    const preface = '不相关文字。'.repeat(500);
    const found = await scanTextSelection(parts([
      { key: 4, text: preface + '准确前文。选中' },
      { key: 3, text: '内容。准确后文。' },
    ]), { before: '准确前文。', highlight: '选中内容。', after: '准确后文。' });
    expect(found).toEqual({ key: 4, offset: preface.length + '准确前文。'.length });
  });

  it('rejects ambiguous overlapping selections and never treats a dropped prefix as a new position', async () => {
    await expect(scanTextSelection(parts([{ key: 'x', text: 'aaaa' }]), { highlight: 'aaa' })).rejects.toThrow('多次出现');
    const text = 'prefix。唯一选文。' + '尾部'.repeat(900);
    const found = await scanTextSelection(parts([{ key: 'x', text }, { key: 'y', text: '结束' }]), { highlight: '唯一选文。' });
    expect(found).toEqual({ key: 'x', offset: 'prefix。'.length });
    await expect(scanTextSelection(parts([{ key: 'x', text }]), { highlight: '缺失' })).rejects.toThrow('未能核对');
    await expect(scanTextSelection(parts([{ key: 'x', text }]), { highlight: '唯一选文。' }, { aborted: true })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preserves full emoji at a budget boundary and rejects a forged split cursor', () => {
    const text = 'a😀b';
    expect(passageSliceEnd(text, 0, 2)).toBe(1);
    expect(passageSliceEnd(text, 1, 1)).toBe(1);
    expect(text.slice(1, passageSliceEnd(text, 1, 2))).toBe('😀');
    expect(() => passageSliceEnd(text, 2, 2)).toThrow('切断字符');
    expect(() => passageSliceEnd(text, 0.5, 2)).toThrow('游标');
  });

  it('refuses cross-book and malformed cursor envelopes', () => {
    expect(() => decodeReadCursor('null', 'b', 'passage')).toThrow('游标无效');
    expect(() => decodeReadCursor('[]', 'b', 'passage')).toThrow('游标无效');
    expect(() => decodeReadCursor(JSON.stringify({ type: 'passage', bookId: 'other' }), 'b', 'passage')).toThrow('不属于当前书');
  });
});
