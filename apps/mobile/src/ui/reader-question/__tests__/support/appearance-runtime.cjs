const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { document } = require('./minimal-dom.cjs');
const mobileRoot = path.resolve(__dirname, '../../../../..');
const repoRoot = path.resolve(mobileRoot, '../..');
const mobile = Module.createRequire(path.join(mobileRoot, 'package.json'));
const React = mobile('react');
const client = mobile('react-dom/client');
const ts = mobile('typescript');
const assistant = Module.createRequire(mobile.resolve('@assistant-ui/react-native'));
const core = assistant('@assistant-ui/core');
const coreReact = assistant('@assistant-ui/core/react');
const aui = assistant('@assistant-ui/store');
const act = async callback => React.act(async () => { await callback(); });
const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : value?.props ? text(value.props.children) : '';

/** Real React reconciler, assistant-ui runtime, ReaderAssistantThread/Parts and routes.
 * Only the native/registry views, scroll geometry, persistence and model are ports. */
function createRuntime({ format = 'pdf', params, initialRoute = 'book-chat' } = {}) {
  const records = new Map(), cache = new Map(), subscribers = new Set(), chatSubscribers = new Set();
  const pushes = [], navigated = [], loads = [], storage = [], chatInputs = [], alerts = [], sent = [];
  let sequence = 0, question, registry, appearance, transition, flushes = 0;
  let locator = format === 'pdf' ? { type: 'pdf', page: 41 } : { type: 'epub', cfi: 'epubcfi(/6/2!/4)' };
  const RouteContext = React.createContext(null);
  let stack = { type: 'stack', key: 'app-stack', index: 0, routeNames: ['reader/[id]', 'book-chat', 'book-chat/materials'], routes: [params
    ? { key: 'history-question', name: initialRoute, params }
    : { key: 'source-reader', name: 'reader/[id]', params: { id: 'book' } }] };
  let rootSnapshot;
  const publish = () => {
    rootSnapshot = { type: 'stack', key: 'expo-root', index: 0, routeNames: ['__root'], routes: [{ key: '__root:0', name: '__root', state: stack }] };
    for (const listener of subscribers) listener();
  };
  publish();
  const subscribe = listener => { subscribers.add(listener); return () => subscribers.delete(listener); };
  const router = {
    push(value) {
      const pathname = typeof value === 'string' ? value : value.pathname;
      const route = { key: 'route-' + ++sequence, name: pathname.slice(1), params: typeof value === 'string' ? {} : value.params };
      pushes.push(route); stack = { ...stack, index: stack.index + 1, routes: [...stack.routes.slice(0, stack.index + 1), route] }; publish();
    },
    back() { if (stack.index === 0) return; stack = { ...stack, index: stack.index - 1, routes: stack.routes.slice(0, stack.index) }; publish(); },
    setParams(patch) { stack = { ...stack, routes: stack.routes.map((route, index) => index === stack.index ? { ...route, params: { ...route.params, ...patch } } : route) }; publish(); },
  };
  const host = kind => function Host(props) {
    const id = React.useId(), route = React.useContext(RouteContext);
    React.useLayoutEffect(() => { records.set(id, { kind, props, id, routeKey: route?.key }); return () => records.delete(id); });
    return React.createElement('test-' + kind.toLowerCase(), null, props.children);
  };
  const native = { Platform: { OS: 'ios' }, StyleSheet: { create: value => value, flatten, hairlineWidth: .5 },
    Keyboard: { dismiss() {} }, Alert: { alert: (...args) => alerts.push(args) },
    Appearance: { setColorScheme() {} }, useColorScheme: () => 'light' };
  for (const kind of ['View', 'Text', 'TextInput', 'Pressable', 'ActivityIndicator']) native[kind] = host(kind);
  const FlatListHost = host('FlatList');
  native.FlatList = props => React.createElement(FlatListHost, props, props.data.length
    ? props.data.map((item, index) => React.createElement(React.Fragment, { key: index }, props.renderItem({ item, index }))) : props.ListEmptyComponent);
  const stubs = { react: React, 'react/jsx-runtime': mobile('react/jsx-runtime'), 'react-native': native,
    'expo-router': { Stack: { Screen: host('StackScreen') }, useRouter: () => router,
      useRootNavigationState: () => React.useSyncExternalStore(subscribe, () => rootSnapshot, () => rootSnapshot),
      useLocalSearchParams: () => React.useContext(RouteContext)?.params ?? {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) },
    'expo-secure-store': { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'fixture', getItemAsync: async () => null, setItemAsync: async (...args) => storage.push(args) },
    'expo-symbols': { SymbolView: host('SymbolView') },
    'expo-image': { Image: host('Image') },
    'lucide-react-native': new Proxy({}, { get: () => host('LucideIcon') }),
    '@/components/ui/icon': { Icon: host('Icon') },
    uniwind: { ScopedTheme: host('ScopedTheme'), useCSSVariable: keys => keys.map(() => '#888') },
    '@assistant-ui/react-native': { ...coreReact, ...aui, MessageNotSentError: core.MessageNotSentError },
  };
  const turn = { id: 'answer-1', role: 'assistant', text: '已保存回答', reasoning: '', tools: [], warnings: [], status: 'done', citations: [],
    sentMaterials: [{ kind: 'selection', id: 'selection-1', name: '选中原文', content: '发送材料样本' }] };
  let turns = [turn];
  const subscribeChat = listener => { chatSubscribers.add(listener); return () => chatSubscribers.delete(listener); };
  const publishTurns = values => { turns = values; for (const listener of chatSubscribers) listener(); };
  const ThreadHost = host('RegistryThread');
  function RegistryThread({ components, ...props }) {
    const messages = aui.useAuiState(state => state.thread.messages);
    return React.createElement(ThreadHost, props, messages.map((message, index) =>
      React.createElement(coreReact.MessageByIndexProvider, { key: message.id, index },
        React.createElement(components.MessageWrapper, null,
          message.role === 'user' ? React.createElement(components.UserHeader) : React.createElement(components.AssistantFooter)))));
  }
  function ComposerInput() {
    const client = aui.useAui();
    const value = aui.useAuiState(state => state.composer.text);
    return React.createElement(native.TextInput, { testID: 'runtime-composer-input', value, onChangeText: text => client.composer().setText(text) });
  }
  function RegistryComposer({ components }) {
    return React.createElement(React.Fragment, null, React.createElement(components.ComposerBefore),
      React.createElement(components.ComposerTools), React.createElement(components.ComposerInput));
  }
  stubs['@/components/assistant-ui/elements/thread.aui'] = { Thread: RegistryThread, ThreadComposer: RegistryComposer };
  // Native geometry is separate from this route/appearance acceptance harness.
  stubs['./AssistantSheetAdapter'] = {
    AssistantSheetLayoutProvider: React.Fragment, AssistantSheetThreadFrame: React.Fragment,
    renderSheetScrollComponent: () => null, SheetComposerInput: ComposerInput, SheetWelcome: () => null,
  };
  stubs['./useChatListScroll'] = { useChatListScroll: (_presentation, onOpenCitation) => {
    const rows = React.useRef(new Map()), list = React.useRef(null), viewport = React.useRef(null);
    return React.useMemo(() => ({ rows, list, viewport, openCitation: onOpenCitation, update() {}, restore() {}, registerCitation() {},
      beginDrag() {}, endDrag() {}, onScroll() {}, onViewableItemsChanged() {}, onContentSizeChange() {} }), [onOpenCitation]);
  } };
  const original = relative => path.join(mobileRoot, relative);
  function load(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file = ['', '.ts', '.tsx'].map(extension => file + extension).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? file;
    if (cache.has(file)) return cache.get(file).exports;
    const mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file)); cache.set(file, mod);
    mod.require = id => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id.endsWith('/library/conversations')) return { createBookConversationId: () => 'question-' + ++sequence };
      if (id.endsWith('/platform/library')) return { loadBookConversation: async conversationId => { loads.push(conversationId); return [{ id: turn.id, details: turn }]; } };
      if (id.endsWith('/library/pure')) return { storedLocatorFromUnknown: value => value?.type === 'pdf' || value?.type === 'epub' ? value : null, readerLocatorFromLegacy: () => null };
      if (id.endsWith('/conversationRuntime')) return { activeConversationRun: () => undefined, subscribeConversationRun: () => () => {} };
      if (id === './haptics') return { tapFeedback() {} };
      if (id.endsWith('/src/ui/chat')) {
        const Sheet = host('ChatSheet');
        return { ChatSheet: props => React.createElement(Sheet, props, props.children, props.footer),
          useBookChat: input => {
            chatInputs.push(input);
            const view = React.useSyncExternalStore(input.presentation.subscribe, input.presentation.getSnapshot, input.presentation.getSnapshot);
            const values = React.useSyncExternalStore(subscribeChat, () => turns, () => turns);
            const setQuestion = React.useCallback(draft => input.presentation.update({ draft }), [input.presentation]);
            return { loading: false, turns: values, title: 'Book', format, availability: { book: { removedAt: null } },
              question: view.draft, setQuestion, running: false, canSend: true, inputEnabled: true, configMissing: false,
              selectionPending: false, service: 'fixture', placeholder: '追问', send: async text => { sent.push(text); return true; }, cancel() {}, retry() {} };
          },
        };
      }
      if (id.startsWith('@/')) return load(original(id.slice(2)));
      if (id.startsWith('.')) {
        const target = path.resolve(path.dirname(file), id);
        for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(target + ext) && fs.statSync(target + ext).isFile()) return load(target + ext);
      }
      return mobile(id);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
    return mod.exports;
  }
  const appearanceModule = load(original('src/ui/appearance.tsx'));
  const provider = load(original('src/ui/reader-question/ReaderQuestionProvider.tsx'));
  const BookChat = load(original('app/book-chat/index.tsx')).default;
  const Materials = load(original('app/book-chat/materials.tsx')).default;
  function Control() { appearance = appearanceModule.useAppearance(); registry = provider.useReaderQuestionRegistry(); transition = provider.useQuestionTransitionEnd(); return null; }
  function Reader() {
    const mode = appearanceModule.useAppearance().resolvedMode;
    question = provider.useReaderQuestions({ bookId: 'book', title: 'Book', format, theme: format === 'pdf' ? mode : 'dark', getLocator: () => locator, documentFailed: false,
      navigate: async command => { navigated.push(command); locator = command.locator; return { operationId: command.operationId, status: 'arrived' }; },
      flushProgress: async () => { flushes++; return true; } });
    return null;
  }
  function Routes() {
    React.useSyncExternalStore(subscribe, () => rootSnapshot, () => rootSnapshot);
    return stack.routes.map(route => React.createElement(RouteContext.Provider, { key: route.key, value: route },
      route.name === 'book-chat' ? React.createElement(BookChat) : route.name === 'book-chat/materials' ? React.createElement(Materials) : React.createElement(Reader)));
  }
  const container = document.createElement('div'); document.body.appendChild(container); const mounted = client.createRoot(container);
  const all = () => [...records.values()];
  const find = (kind, predicate = () => true) => { const value = all().find(record => record.kind === kind && predicate(record)); assert(value, 'missing host ' + kind); return value; };
  return { all, find, pushes, navigated, loads, storage, alerts, chatInputs, sent, act,
    get stack() { return stack; }, get registry() { return registry; }, get question() { return question; }, get appearance() { return appearance; }, get flushes() { return flushes; },
    get presentation() { return chatInputs.at(-1)?.presentation; }, get locator() { return locator; },
    async mount() { await act(() => mounted.render(React.createElement(appearanceModule.AppearanceProvider, null, React.createElement(provider.ReaderQuestionProvider, null, React.createElement(Control), React.createElement(Routes))))); },
    async close() { await act(() => mounted.unmount()); document.body.removeChild(container); },
    async mode(mode) { await act(() => appearance.setMode(mode)); },
    async ask(selection, times = 1) { await act(() => { for (let i = 0; i < times; i++) question.ask(selection); }); },
    async openHistory(conversationId) { await act(() => router.push({ pathname: '/book-chat', params: { bookId: 'book', conversationId } })); },
    async back() { await act(() => router.back()); },
    async params(patch) { await act(() => router.setParams(patch)); },
    async transition(routeKey, closing = false) { await act(() => transition({ target: routeKey, data: { closing } })); },
    async openMaterials() { await act(() => find('Pressable', record => record.props.testID === 'question-more-answer-1').props.onPress()); },
    async editDraft(value) { await act(() => find('TextInput', record => record.props.testID === 'runtime-composer-input').props.onChangeText(value)); },
    draft() { return find('TextInput', record => record.props.testID === 'runtime-composer-input').props.value; },
    async citation(target, twice = false) {
      const key = stack.routes[stack.index].key;
      const prior = Array.from({ length: target.ordinal - 1 }, (_, index) => ({ id: 'prior-' + index, quote: 'Earlier citation', locator: JSON.stringify(target.locator), chapter: '其他原文' }));
      await act(() => publishTurns([{ ...turn, citations: [...prior, { id: target.id, quote: target.quote, locator: JSON.stringify(target.locator), chapter: '目标原文' }] }]));
      await act(() => { const press = find('Pressable', record => record.routeKey === key && record.props.accessibilityLabel === '查看原文：目标原文').props.onPress; press(); if (twice) press(); });
      await act(() => transition({ target: key, data: { closing: true } }));
    },
    async returned(twice = false) { await act(async () => { const promise = question.returnToQuestion(); if (twice) question.returnToQuestion(); await promise; }); },
    palette() { return find('ChatSheet', record => record.routeKey === stack.routes.findLast(route => route.name === 'book-chat')?.key).props.palette; },
    materialsPaper() { return find('StackScreen', record => record.routeKey === stack.routes[stack.index].key).props.options.headerStyle.backgroundColor; },
  };
}
module.exports = { createRuntime, repoRoot, act, flatten, text };
