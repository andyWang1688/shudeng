import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real hook + runtime + writer; native adapters and React scheduling are isolated.
const h = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], append: vi.fn(), start: vi.fn(), load: vi.fn(), beginBackground: vi.fn(), config: null, configError: undefined, indexAvailable: true }));
const book = { id: 'unsaved-book', title: '原书名', format: 'epub', removedAt: null };
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
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return { useFocusEffect: effect => useEffect(effect, [effect]) };
});
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../../platform/ai/bookChatBackground', () => ({ beginBookChatBackgroundTask: h.beginBackground }));
vi.mock('../../../platform/ai', () => ({
  getBookChatSource: async () => {
    if (h.sourceFailure) throw h.sourceFailure;
    return { book, sourceAvailable: true, sourceError: null };
  },
  getBookChatAvailability: async () => {
    if (h.indexGate) await h.indexGate;
    if (h.sourceFailure) throw h.sourceFailure;
    return { book, sourceAvailable: true, config: h.config, configError: h.configError,
      index: { available: h.indexAvailable, detail: '' } };
  },
  startBookChatTurn: (...args) => h.start(...args),
}));
vi.mock('../../../platform/library', () => ({
  appendBookChatTurn: (...args) => h.append(...args),
  createBookConversationId: () => 'unsaved-hook', loadBookConversation: (...args) => h.load(...args),
  registerConversationRun: (_id, cancel) => { h.cancelRun = cancel; return () => { h.cancelRun = undefined; }; },
  cancelConversationRun: () => h.cancelRun?.(), isBookConversationDeleted: () => false,
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
  h.beginBackground.mockReset();
  h.cancelRun = undefined;
  h.config = { name: '本机', provider: 'openai', model: 'test', apiKey: 'synthetic' };
  h.indexAvailable = true;
  h.indexGate = undefined;
  h.sourceFailure = undefined;
  h.configError = undefined;
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
  it('preserves a stopped question without starting the model after the pending save finishes', async () => {
    let save;
    h.append.mockImplementationOnce(() => new Promise(resolve => { save = resolve; }));
    const chat = await open();
    const sent = chat.send('刚发送的问题');
    await settle();
    chat.cancel();
    save();
    expect(await sent).toBe(true);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.append).toHaveBeenLastCalledWith(expect.objectContaining({
      question: '刚发送的问题', details: expect.objectContaining({ status: 'cancelled' }),
    }));
    expect(render().turns.at(-1)).toMatchObject({ status: 'cancelled', sourceQuestion: '刚发送的问题' });
  });

  it('hands over the scroll position only for an accepted question, before publishing it', async () => {
    let chat = await open();
    const accepted = vi.fn(() => {
      expect(activeConversationRun('unsaved-hook')).toBeUndefined();
      expect(h.start).not.toHaveBeenCalled();
    });
    expect(await chat.send(' ', accepted)).toBe(false);
    expect(accepted).not.toHaveBeenCalled();
    const sent = chat.send('继续追问', accepted);
    expect(accepted).toHaveBeenCalledOnce();
    expect(activeConversationRun('unsaved-hook')?.turn.sourceQuestion).toBe('继续追问');
    const rejected = vi.fn();
    expect(await chat.send('并发问题', rejected)).toBe(false);
    expect(rejected).not.toHaveBeenCalled();
    await sent;
  });

  it('opens saved answers and retains a draft before the book index finishes preparing', async () => {
    let finishIndex;
    h.indexGate = new Promise(resolve => { finishIndex = resolve; });
    const citations = [{ id: 'E1', quote: '原文', locator: 'chapter.xhtml' }];
    h.load.mockResolvedValue([
      { id: 'saved:user', role: 'user', text: '首问', reasoning: '', citations: [], details: { status: 'done' } },
      { id: 'saved', role: 'assistant', text: '保存的回答', reasoning: '', citations, details: { status: 'done' } },
    ]);
    let chat = await open();
    expect(chat.loading).toBe(false);
    expect(chat.turns[1]).toMatchObject({ text: '保存的回答', citations });
    expect(chat.sourceAvailable).toBe(true);
    expect(chat.checkingAvailability).toBe(true);
    chat.setQuestion('索引好了再发送');
    chat = render();
    expect(chat.canSend).toBe(false);
    expect(await chat.send()).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
    finishIndex();
    await settle();
    chat = render();
    expect(chat.question).toBe('索引好了再发送');
    expect(chat.checkingAvailability).toBe(false);
    expect(chat.canSend).toBe(true);
    await chat.send();
    expect(h.start.mock.lastCall[0]).toMatchObject({
      question: '索引好了再发送', history: [{ question: '首问', answer: '保存的回答' }],
    });
  });

  it('shows saved history when the original book lookup fails', async () => {
    h.sourceFailure = new Error('暂时无法读取原书');
    h.load.mockResolvedValue([
      { id: 'saved:user', role: 'user', text: '首问', reasoning: '', citations: [], details: { status: 'done' } },
      { id: 'saved', role: 'assistant', text: '已保存的回答', reasoning: '', citations: [], details: { status: 'done' } },
    ]);
    const chat = await open({ initialQuestion: '追问' });
    expect(chat.loading).toBe(false);
    expect(chat.turns[1]).toMatchObject({ text: '已保存的回答' });
    expect(chat.sourceAvailable).toBe(false);
    expect(chat.loadError).toBe('暂时无法读取原书');
    expect(await chat.send()).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('does not clear a history read error or send without history when the index is ready', async () => {
    h.load.mockRejectedValue(new Error('读取对话失败'));
    const chat = await open({ initialQuestion: '保留这条问题' });
    expect(chat.loading).toBe(false);
    expect(chat.loadError).toBe('读取对话失败');
    expect(chat.question).toBe('保留这条问题');
    expect(chat.canSend).toBe(false);
    expect(await chat.send()).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
  });

  it('does not send an old initial question if the draft changes during index preparation', async () => {
    let finishIndex;
    h.indexGate = new Promise(resolve => { finishIndex = resolve; });
    let chat = await open({ initialQuestion: '原始问题' });
    chat.setQuestion('我改过的问题');
    await flush();
    finishIndex();
    await settle();
    render();
    chat = await flush();
    expect(chat.question).toBe('我改过的问题');
    expect(h.start).not.toHaveBeenCalled();
    await chat.send();
    expect(h.start.mock.lastCall[0].question).toBe('我改过的问题');
  });

  it('saves a partial answer as interrupted and releases the iOS background task on expiration', async () => {
    const end = vi.fn();
    h.beginBackground.mockReturnValue(end);
    let cancelRun;
    const cancelled = new Promise(resolve => { cancelRun = resolve; });
    const cancel = vi.fn(cancelRun);
    let receivedText;
    const partial = new Promise(resolve => { receivedText = resolve; });
    h.start.mockResolvedValue({ session: { cancel, result: cancelled, events: (async function* () {
      yield { type: 'textDelta', delta: '已经收到的正文。' };
      receivedText();
      await cancelled;
      yield { type: 'cancelled' };
    })() } });
    const chat = await open();
    const sent = chat.send('后台测试');
    await partial;
    expect(h.beginBackground).toHaveBeenCalledOnce();
    h.beginBackground.mock.calls[0][0]();
    await sent;

    expect(cancel).toHaveBeenCalledOnce();
    expect(h.append).toHaveBeenLastCalledWith(expect.objectContaining({ answer: '已经收到的正文。',
      details: expect.objectContaining({ status: 'error', error: expect.stringContaining('系统后台') }) }));
    expect(end).toHaveBeenCalledOnce();
    expect(end.mock.invocationCallOrder[0]).toBeGreaterThan(h.append.mock.invocationCallOrder.at(-1));
  });

  it('opens saved history without send consent and only shows the config error when sending', async () => {
    h.config = null;
    h.configError = '请先确认此服务的发送说明';
    h.load.mockResolvedValue([
      { id: 'saved:user', role: 'user', text: '首问', reasoning: '', citations: [], details: { status: 'done' } },
      { id: 'saved', role: 'assistant', text: '保存的回答', reasoning: '', citations: [], details: { status: 'done' } },
    ]);
    let chat = await open();
    expect(chat.turns.map(turn => turn.text)).toEqual(['首问', '保存的回答']);
    expect(chat.loadError).toBeNull();
    expect(chat.configurationNotice).toBeNull();
    chat.setQuestion('保留追问');
    chat = render();
    expect(await chat.send()).toBe(false);
    chat = render();
    expect(chat.configurationNotice).toBe(h.configError);
    expect(chat.question).toBe('保留追问');
    expect(h.start).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
    chat.dismissConfigurationNotice();
    chat.retry({ ...chat.turns[1], status: 'error', sourceQuestion: '首问' });
    await settle();
    chat = render();
    expect(chat.configurationNotice).toBe(h.configError);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
  });

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

    h.append.mockRejectedValueOnce(Error('disk still unavailable'));
    chat.retry(failed);
    await settle(); chat = render();
    const failedRetry = chat.turns.find(turn => turn.id === failed.id);
    expect(chat.loadError).toBeNull();
    expect(failedRetry.saveError).toContain('disk still unavailable');
    expect(chat.canSend).toBe(false);

    let release;
    const saving = new Promise(resolve => { release = resolve; });
    h.append.mockImplementation(async () => saving);
    const before = h.append.mock.calls.length;
    chat.retry(failedRetry); chat.retry(failedRetry);
    await settle();
    expect(h.append.mock.calls.length - before).toBe(1);
    release(); await settle(); chat = render();
    expect(activeConversationRun('unsaved-hook')).toBeUndefined();
    expect(chat.turns.find(turn => turn.id === failed.id).saveError).toBeUndefined();
    expect(chat.loadError).toBeNull();
    expect(h.start).toHaveBeenCalledTimes(1);
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

  it('keeps an older retry in order after reopening the conversation while it runs', async () => {
    const saved = [
      { id: 'first:user', role: 'user', text: '第一问', reasoning: '', citations: [], details: { status: 'done' } },
      { id: 'first', role: 'assistant', text: '未完成', reasoning: '', citations: [], details: { status: 'error' } },
      { id: 'second:user', role: 'user', text: '第二问', reasoning: '', citations: [], details: { status: 'done' } },
      { id: 'second', role: 'assistant', text: '第二答', reasoning: '', citations: [], details: { status: 'done' } },
    ];
    h.load.mockResolvedValue(saved);
    h.append.mockResolvedValue(undefined);
    let completeRetry;
    const result = new Promise(resolve => { completeRetry = resolve; });
    h.start.mockResolvedValueOnce({ session: { result, cancel() {}, events: (async function* () {
      yield { type: 'completed', result: await result };
    })() } });

    let chat = await open();
    chat.retry(chat.turns[1]);
    await settle();
    expect(h.start.mock.lastCall[0].history).toEqual([]);
    unmount();
    chat = await open();
    expect(chat.turns[1]).toMatchObject({ id: 'first', status: 'streaming' });
    completeRetry({ answer: '第一答', citations: [], warnings: [] });
    await settle();
    chat = render();
    expect(chat.turns.map(turn => turn.text)).toEqual(['第一问', '第一答', '第二问', '第二答']);
    await chat.send('第三问');
    expect(h.start.mock.lastCall[0].history).toEqual([
      { question: '第一问', answer: '第一答' },
      { question: '第二问', answer: '第二答' },
    ]);
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

  it.each(['live', 'reopened'])('keeps saved web evidence on the earlier turn for a %s follow-up', async path => {
    const webSources = [{ id: 'W1', title: '官方说明', url: 'https://example.org/guide', provider: 'deepseek' }];
    const result = { answer: '见官方说明。', citations: [], warnings: [], webSources };
    const details = { status: 'done', webSources, webSearchStatus: { status: 'complete' } };
    if (path === 'reopened') {
      h.load.mockResolvedValue([
        { id: 'old:user', role: 'user', text: '查一下说明', reasoning: '', citations: [], details: { status: 'done' } },
        { id: 'old', role: 'assistant', text: result.answer, reasoning: '', citations: [], details },
      ]);
    } else {
      h.start.mockResolvedValueOnce({ session: { events: (async function* () {
        yield { type: 'webSearchStatus', status: 'complete' };
        yield { type: 'completed', result };
      })(), result: Promise.resolve(result), cancel() {} } });
    }
    let chat = await open();
    if (path === 'live') { await chat.send('查一下说明'); chat = render(); }
    await chat.send('刚才的网页是哪一个？');
    expect(h.start.mock.lastCall[0].history).toEqual([{ question: '查一下说明', answer: result.answer,
      webSearchStatus: 'complete', webSources }]);
    expect(render().turns.filter(turn => turn.role === 'assistant').at(-1).webSources).toBeUndefined();
  });
});
