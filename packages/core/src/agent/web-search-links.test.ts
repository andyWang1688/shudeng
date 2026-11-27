import { describe, expect, it } from 'vitest';
import { ProviderWebSearch, resolveWebSearchPolicy } from './web-search.js';

const policy = resolveWebSearchPolicy('deepseek', undefined, { enabled: true }, 'deepseek-flash');

describe('DeepSeek links in a reader question', () => {
  it.each([
    ['Open https://example.org/guides/web_tools, then check the book.', 'Open [链接], then check the book.'],
    ['Read https://example.org/guides/web_tools.', 'Read [链接].'],
  ])('sends the URL without surrounding prose punctuation: %s', (question, prose) => {
    const search = new ProviderWebSearch(policy, () => {}, question);
    expect(search.tools()).toEqual([{ type: 'deepseek_read_url' }]);
    expect(search.questionLinks).toEqual(['https://example.org/guides/web_tools']);
    expect(search.linkReadingQuestion(question)).toContain('\nhttps://example.org/guides/web_tools\n');
    expect(search.linkReadingQuestion(question).split('\n').at(-1)).toBe(prose);
  });

  it('keeps punctuation within the URL and at the end of an explicitly delimited link', () => {
    const withQuery = 'https://example.org/report.v1?tags=books,reading';
    const delimited = 'https://example.org/ends-in-period.';
    const question = `Read ${withQuery}, then <${delimited}>.`;
    const search = new ProviderWebSearch(policy, () => {}, question);
    expect(search.questionLinks).toEqual([withQuery, delimited]);
    expect(search.linkReadingQuestion(question).split('\n').at(-1)).toBe('Read [链接], then <[链接]>.');
  });
});
