import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../../../../package.json", import.meta.url),
);
const ts = require("typescript");

/** Run the real sheet and shared hook; native layout/animation is controlled by the test. */
export function readerSheet(name: "NoteSheet" | "ReaderPanel", initial: any) {
  return readerComponent(
    new URL("../" + name + ".tsx", import.meta.url),
    name,
    initial,
  );
}

export function readerComponent(
  file: URL,
  name: string,
  initial: any,
  overrides: Record<string, any> = {},
) {
  const state: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  let props = initial;
  const different = (a: any[], b: any[]) =>
    !a ||
    !b ||
    a.length !== b.length ||
    a.some((value, i) => !Object.is(value, b[i]));
  const hooks = {
    useState(initial: any) {
      const i = cursor++;
      state[i] ??= { value: initial };
      return [
        state[i].value,
        (next: any) => {
          state[i].value = next;
        },
      ];
    },
    useRef(initial: any) {
      const i = cursor++;
      return (state[i] ??= { current: initial });
    },
    useMemo(factory: any, deps: any[]) {
      const i = cursor++;
      if (!state[i] || different(state[i].deps, deps))
        state[i] = { deps, value: factory() };
      return state[i].value;
    },
    useCallback(callback: any, deps: any[]) {
      return hooks.useMemo(() => callback, deps);
    },
    useEffect(effect: any, deps: any[]) {
      const i = cursor++;
      if (!state[i] || different(state[i].deps, deps)) {
        const old = state[i];
        state[i] = { deps };
        effects.push(() => {
          old?.cleanup?.();
          state[i].cleanup = effect();
        });
      }
    },
    createContext: (value: any) => ({ value }),
    useContext: (context: any) => context.value,
  };
  const palette = new Proxy({}, { get: (_target, key) => key });
  const jsx = (type: any, props: any) => ({ type, props });
  const mocks: Record<string, any> = {
    react: { ...hooks, useLayoutEffect: hooks.useEffect },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Keyboard: { dismiss() {} },
      Modal: "Modal",
      Pressable: "Pressable",
      Text: "Text",
      View: "View",
      StyleSheet: { create: (value: any) => value },
    },
    "react-native-safe-area-context": {
      useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
    },
    "@gorhom/bottom-sheet": {
      __esModule: true,
      default: "BottomSheet",
      BottomSheetScrollView: "ScrollView",
      BottomSheetTextInput: "TextInput",
    },
    "react-native-gesture-handler": {
      GestureHandlerRootView: "GestureHandlerRootView",
    },
    "lucide-react-native": { Maximize2: "Maximize2", Trash2: "Trash2", X: "X" },
    "../theme": { usePalette: () => palette },
    "../components/BookNotice": { BookNotice: "BookNotice" },
    "../components/AppSheet": { AppSheet: "AppSheet" },
    ...overrides,
  };
  const modules = new Map<string, any>();
  const load = (file: string): any => {
    if (modules.has(file)) return modules.get(file).exports;
    const compiled: any = new Module(file);
    compiled.filename = file;
    modules.set(file, compiled);
    compiled.require = (id: string) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith(".")) return load(resolve(dirname(file), id + ".ts"));
      throw Error("Unmocked " + id);
    };
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    compiled._compile(code, file);
    return compiled.exports;
  };
  const component = load(fileURLToPath(file))[name];
  return {
    render(next?: any) {
      if (next) props = next;
      cursor = 0;
      const tree = component(props);
      const nextEffects = effects;
      effects = [];
      nextEffects.forEach((effect) => effect());
      return tree;
    },
    unmount() {
      state.forEach((entry) => entry.cleanup?.());
    },
  };
}

export function find(tree: any, type: string, id?: string): any {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree))
    return tree.map((entry) => find(entry, type, id)).find(Boolean);
  if (tree.type === type && (!id || tree.props.testID === id)) return tree;
  return find(tree.props?.children, type, id);
}
