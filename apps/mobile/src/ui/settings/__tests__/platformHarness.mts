import { readFileSync, existsSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/mobile/package.json"));
const ts = require("typescript");
export function loader(ports: Record<string, any>) {
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const compiled: any = new Module(file);
    cache.set(file, compiled); compiled.filename = file;
    compiled.require = (id: string) => {
      if (Object.hasOwn(ports, id)) return ports[id];
      if (id.startsWith(".")) {
        const target = path.resolve(path.dirname(file), id);
        const candidate = [target, target + ".ts", target + ".tsx"].find(existsSync);
        if (candidate) return load(candidate);
      }
      throw new Error("Unexpected dependency: " + id);
    };
    compiled._compile(ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, file);
    return compiled.exports;
  };
  return load;
}
export const jsx = (type: unknown, props: any) => ({ type, props });
export function hooks() {
  let cursor = 0; const slots: any[] = [], effects: (() => void)[] = [];
  const same = (a: any[], b: any[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react: any = {
    useState(value: any) { const i = cursor++; slots[i] ??= { value: typeof value === "function" ? value() : value }; return [slots[i].value, (v: any) => { slots[i].value = typeof v === "function" ? v(slots[i].value) : v; }]; },
    useRef(value: any) { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn: any, deps: any[]) { return react.useMemo(() => fn, deps); },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const previous = slots[i]; const slot = { deps, cleanup: undefined as any, setup: fn }; slots[i] = slot; effects.push(() => { previous?.cleanup?.(); slot.cleanup = fn(); }); } },
  };
  return { react, render(fn: () => any) { cursor = 0; const tree = fn(); while (effects.length) effects.shift()!(); return tree; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); }, restart() { slots.forEach(slot => { if (slot?.setup) { slot.cleanup?.(); slot.cleanup = slot.setup(); } }); } };
}
export function nodes(tree: any, predicate: (n: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(n => nodes(n, predicate));
  return [...(predicate(tree) ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(n => nodes(n, predicate))];
}
export async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }
export function nativePorts(alerts: any[]) {
  return new Proxy({ StyleSheet: { create: (v: any) => v, hairlineWidth: 1 }, Platform: { OS: "ios" }, Alert: { alert: (...v: any[]) => alerts.push(v) } }, { get(target: any, key) { return target[key] ?? String(key); } });
}
export const parts = { SettingsAction: "SettingsAction", SettingsHeader: "SettingsHeader", SettingsRow: "SettingsRow", SettingsSection: "SettingsSection", showSettingsChoices() {} };
