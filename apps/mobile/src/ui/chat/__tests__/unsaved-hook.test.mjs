import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real hook + runtime + writer; native adapters and React scheduling are isolated.
const h = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], append: vi.fn(), start: vi.fn(), load: vi.fn(), config: null, indexAvailable: true }));
vi.mock('react', () => {
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (factory, deps) => {
    const i = h.cursor++;
    if (!h.slots[i] || !equal(h.slots[i].deps, deps)) h.slots[i] = { value: factory(), deps };
    return h.slots[i].value;
  };
  return {
    useState(initial) {
      const i = h.cursor++; h.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [h.slots[i].value, next => { h.slots[i].value = typeof next === 'function' ? next(h.slots[i].value) : next; }];
    },
    useRef(initial) { const i = h.cursor++; h.slots[i] ??= { value: { current: initial } }; return h.slots[i].value; },
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(effect, deps) {
      const i = h.cursor++; const previous = h.slots[i];
      if (previous && equal(previous.deps, deps)) return;
      h.slots[i] = { value: undefined, deps };
      h.effects.push(() => { previous?.cleanup?.(); h.slots[i].cleanup = effect(); });
    },
  };
});
vi.mock('expo-router', () => ({ useFocusEffect: () => {} }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../../platform/ai', () => ({
  getBookChatAvailability: async () => ({
    book: { id: 'unsaved-book', title: '原书名', format: 'epub', removedAt: null },
    config: h.config,
    index: { available: h.indexAvailable, detail: '' },
  }),
  startBookChatTurn: (...args) => h.start(...args),
}));
vi.mock('../../../platform/library', () => ({
  appendBookChatTurn: (...args) => h.append(...args),
  createBookConversationId: () => 'unsaved-hook', loadBookConversation: (...args) => h.load(...args),
  registerConversationRun: () => () => {}, cancelConversationRun() {}, isBookConversationDeleted: () => false,
}));
import { useBookChat } from '../useBookChat';
import { activeConversationRun, discardConversationRun, finishConversationRun, publishConversationRun } from '../conversationRuntime';

const options = { bookId: 'unsaved-book', conversationId: 'unsaved-hook' };
let currentOptions;
function render() { h.cursor = 0; return useBookChat(currentOptions); }
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
async function flush() { for (const effect of h.effects.splice(0)) effect(); await settle(); return render(); }
async function open(extra = {}) { currentOptions = { ...options, ...extra }; render(); return flush(); }
function unmount() { for (const slot of h.slots) slot.cleanup?.(); h.slots = []; h.cursor = 0; h.effects = []; }

beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.append.mockReset(); h.start.mockReset();
  h.config = { name: '本机', provider: 'openai', model: 'test', apiKey: 'synthetic' };
  h.indexAvailable = true;
  h.load.mockReset(); h.load.mockResolvedValue([]);
  vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0));
  vi.stubGlobal('cancelAnimationFrame', id => clearTimeout(id));
  h.start.mockImplementation(async () => {
    const result = { answer: '真实完成的回答', citations: [], warnings: [] };
    return { session: { events: (async function* () { yield { type: 'completed', result }; })(), result: Promise.resolve(result), cancel() {} } };
  });
});
afterEach(() => { unmount(); discardConversationRun('unsaved-hook'); vi.unstubAllGlobals(); });

describe('unsaved conversation run boundary', () => {
  it('only prompts for missing model configuration after sending and keeps draft and selection without a request', async () => {
    h.config = null;
    h.indexAvailable = false;
    const presentationState = { draft: '为什么这样说？', selection: { start: 0, end: 0 }, selectionConsumed: false };
    const presentation = { getSnapshot: () => presentationState, update: patch => Object.assign(presentationState, patch) };
    let chat = await open({ selectionQuote: '保留这段原文', presentation });
    expect(chat.configurationNotice).toBeNull();
    expect(chat.canSend).toBe(true);
    expect(await chat.send()).toBe(false);
    chat = render();
    expect(chat.configurationNotice).toContain('还没有配置 AI 模型');
    expect(chat.question).toBe('为什么这样说？');
    expect(presentationState.draft).toBe('为什么这样说？');
    expect(presentationState.selectionConsumed).toBe(false);
    expect(chat.selectionPending).toBe(true);
    expect(chat.running).toBe(false);
    expect(chat.turns).toEqual([]);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
    chat.dismissConfigurationNotice();
    expect(render().configurationNotice).toBeNull();
  });

  it('blocks fresh and stale sends and retries before saving, preserving a reopened draft and selection', async () => {
    h.append.mockImplementation(async input => { if (input.details.status === 'done') throw Error('disk full'); });
    let chat = await open();
    const staleSend = chat.send;
    await chat.send('第一轮'); chat = render();
    expect(h.start).toHaveBeenCalledTimes(1);
    const failed = chat.turns.find(turn => turn.role === 'assistant');
    expect(failed.saveError).toContain('disk full');
    expect(activeConversationRun('unsaved-hook').turn.id).toBe(failed.id);
    unmount();
    chat = await open({ selectionQuote: '重新选中的原文' });
    chat.setQuestion('保留草稿'); chat = render();
    expect(chat.selectionPending).toBe(true);
    expect(chat.canSend).toBe(false);
    await chat.send();
    await staleSend('旧闭包试图发问');
    chat.retry({ ...failed, id: 'another-turn', saveError: undefined, sourceQuestion: '另一轮重试' });
    await settle(); chat = render();
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(chat.question).toBe('保留草稿');
    expect(chat.selectionPending).toBe(true);
    expect(activeConversationRun('unsaved-hook').turn.id).toBe(failed.id);

    let release;
    const saving = new Promise(resolve => { release = resolve; });
    h.append.mockImplementation(async () => saving);
    const before = h.append.mock.calls.length;
    chat.retry(failed); chat.retry(failed);
    await settle();
    expect(h.append.mock.calls.length - before).toBe(1);
    release(); await settle(); chat = render();
    expect(activeConversationRun('unsaved-hook')).toBeUndefined();
    expect(chat.canSend).toBe(true);
    expect(chat.question).toBe('保留草稿');
    h.append.mockResolvedValue(undefined);
    await chat.send(); chat = render();
    expect(h.start).toHaveBeenCalledTimes(2);
    expect(h.start.mock.calls[1][0].selectionQuote).toBe('重新选中的原文');
    expect(chat.selectionPending).toBe(false);
  });

  it('ignores a late old-turn finish while a different turn is running', () => {
    const turn = { id: 'new-turn', role: 'assistant', text: '', reasoning: '', tools: [], citations: [], warnings: [], status: 'streaming' };
    publishConversationRun('unsaved-hook', turn, { bookId: 'unsaved-book', bookTitle: '书' });
    finishConversationRun('unsaved-hook', { ...turn, id: 'old-turn', status: 'done' });
    expect(activeConversationRun('unsaved-hook')).toMatchObject({ running: true, turn: { id: 'new-turn' } });
  });

  it('replays all prior question/answer text on normal follow-up without reusing a prior run summary', async () => {
    h.append.mockResolvedValue(undefined);
    h.start.mockImplementation(async () => {
      const result = { answer: '回答', citations: [], warnings: [], contextSummary: '仅属于上一轮的摘要' };
      return { session: { events: (async function* () { yield { type: 'completed', result }; })(),
        result: Promise.resolve(result), cancel() {} } };
    });
    let chat = await open({ selectionQuote: '首次附带原文' });
    for (let i = 0; i < 6; i++) {
      await chat.send('问题' + i); chat = render();
    }
    expect(h.start.mock.calls[0][0].question).toBe('问题0');
    for (let i = 1; i < 6; i++) {
      const request = h.start.mock.calls[i][0];
      expect(request.history).toHaveLength(i);
      expect(request.history[0].question).toBe('问题0');
      expect(request.historySummary).toBeUndefined();
      expect(request.selectionQuote).toBe('首次附带原文');
    }
  });

  it('restores fixed selection from the saved first turn when history opens without route selection', async () => {
    const quote = '已保存的独有原文';
    h.load.mockResolvedValue([
      { id: 'saved:user', role: 'user', text: '首问', reasoning: '', citations: [], details: { status: 'done' } },
      { id: 'saved', role: 'assistant', text: '不复述原文的回答', reasoning: '', citations: [], details: { status: 'done', selectionQuote: quote } },
    ]);
    h.append.mockResolvedValue(undefined);
    const chat = await open();
    await chat.send('这段是什么意思');
    expect(h.start.mock.calls[0][0].selectionQuote).toBe(quote);
    expect(h.start.mock.calls[0][0].history[0].question).toBe('首问');
  });
});
