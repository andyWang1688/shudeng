import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
const path = new URL("./usePdfReader.ts", import.meta.url);
const source = ts.createSourceFile(
  path.pathname,
  readFileSync(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let callback: any;
const visit = (node: any) => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "pickColor"
  )
    callback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(callback, "execute the real highlight persistence callback");
const code = ts.transpileModule(
  "module.exports = " + callback.getText(source),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;

function harness(color: string | null) {
  const writes: any[] = [],
    failures: string[] = [],
    errors: string[] = [];
  const context: any = {
    module: { exports: null },
    bookId: "owned-book",
    fileUri: "file:///owned.pdf",
    annotationOwner: {
      current: {
        active: true,
        bookId: "owned-book",
        fileUri: "file:///owned.pdf",
      },
    },
    paletteTarget: {
      quote: "原文",
      locator: { type: "pdf", page: 7 },
      annotation: color === null ? null : { id: "existing", color },
    },
    committedHighlights: { current: new WeakSet() },
    saveInFlight: { current: false },
    saveOperation: { current: null },
    preferredColor: { current: "yellow" },
    highlightColor: (value: string) => (value === "pink" ? "rose" : value),
    setSavingAnnotation(value: boolean) {
      context.busy = value;
    },
    busy: false,
    setPaletteTarget(next: any) {
      context.paletteTarget =
        typeof next === "function" ? next(context.paletteTarget) : next;
    },
    clearSelection() {
      context.clears++;
    },
    clears: 0,
    ownsAnnotationUI: (owner: any) =>
      owner.active && owner === context.annotationOwner.current,
    deleteReaderAnnotation: async (id: string) => {
      writes.push({ action: "delete", id });
    },
    updateReaderAnnotation: async (id: string, patch: any) => {
      writes.push({ action: "update", id, ...patch });
    },
    saveReaderAnnotation: async (_book: string, input: any) => {
      writes.push({ action: "create", ...input });
    },
    refreshAnnotations: async () => {},
    SecureStore: { setItemAsync: async () => {} },
    HIGHLIGHT_COLOR_KEY: "test-key",
    persistError: (_title: string, error: Error) =>
      failures.push(error.message),
    setError: (message: string) => errors.push(message),
  };
  runInNewContext(code, context);
  return {
    context,
    writes,
    failures,
    errors,
    pick: (next: string) => context.module.exports(next),
  };
}

test("existing same color cancels by original id, including migrated pink, while a new highlight creates", async () => {
  for (const color of ["yellow", "pink"]) {
    const h = harness(color);
    await h.pick(color === "pink" ? "rose" : color);
    assert.deepEqual(h.writes, [{ action: "delete", id: "existing" }]);
    assert.equal(h.context.paletteTarget, null);
    assert.equal(h.context.busy, false);
  }
  const fresh = harness(null);
  await fresh.pick("yellow");
  assert.equal(fresh.writes.length, 1);
  assert.equal(fresh.writes[0].action, "create");
  assert.equal(fresh.writes[0].kind, "highlight");
});

test("different color updates the same annotation and closes only after persistence", async () => {
  const h = harness("yellow");
  let release!: () => void;
  h.context.updateReaderAnnotation = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const target = h.context.paletteTarget;
  const pending = h.pick("green");
  assert.equal(h.context.busy, true);
  assert.equal(h.context.paletteTarget, target);
  await h.pick("blue");
  assert.equal(h.context.paletteTarget, target);
  release();
  await pending;
  assert.equal(h.context.paletteTarget, null);
  assert.equal(h.context.busy, false);
});

test("rejected delete retains the palette and releases the write lock for retry", async () => {
  const h = harness("yellow");
  const target = h.context.paletteTarget;
  h.context.deleteReaderAnnotation = async () => {
    throw Error("disk unavailable");
  };
  await h.pick("yellow");
  assert.equal(h.context.paletteTarget, target);
  assert.equal(h.context.busy, false);
  assert.deepEqual(h.failures, ["disk unavailable"]);
  h.context.deleteReaderAnnotation = async (id: string) =>
    h.writes.push({ action: "delete", id });
  await h.pick("yellow");
  assert.equal(h.context.paletteTarget, null);
  assert.equal(h.writes.length, 1);
});

test("a durable creation survives reload failure and stale callbacks cannot create it twice", async () => {
  const h = harness(null);
  const oldTarget = h.context.paletteTarget;
  h.context.refreshAnnotations = async () => {
    throw Error("reload failed");
  };
  await h.pick("blue");
  assert.equal(h.context.paletteTarget, null);
  assert.equal(h.errors.length, 1);
  h.context.paletteTarget = oldTarget;
  await h.pick("blue");
  assert.equal(h.writes.length, 1);
});

test("late completion cannot close a replacement reader palette", async () => {
  const h = harness(null);
  let release!: () => void;
  h.context.saveReaderAnnotation = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const pending = h.pick("green");
  h.context.annotationOwner.current.active = false;
  const replacement = { quote: "另一份书的原文" };
  h.context.paletteTarget = replacement;
  release();
  await pending;
  assert.equal(h.context.paletteTarget, replacement);
  assert.equal(h.context.clears, 0);
  assert.deepEqual(h.failures, []);
});
