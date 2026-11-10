import test from "node:test";
import assert from "node:assert/strict";
import { hooks, jsx, loader, nativePorts, nodes, parts, flush } from "./platformHarness.mts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const service = (name: string, consent = "approved") => ({ id: name, name, model: "test", provider: "openai", baseUrl: "https://example.com/v1", consentScope: consent });
const catalog = (name: string) => ({ version: 2, selectedId: name, services: [service(name)] });
function settings() {
  const h = hooks();
  let focused = true;
  const reads: ReturnType<typeof deferred<any>>[] = [];
  const selects: any[] = [], removes: any[] = [], edits: any[] = [];
  const consent = deferred<boolean>(), mutation = deferred<void>();
  let needsConsent = false, waitMutation = false;
  const Screen = loader({
    react: h.react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": nativePorts([]),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../theme": { usePalette: () => ({}) },
    "./SettingsParts": parts,
    "./ServiceList": { ServiceList: "ServiceList" },
    "../components/BookNotice": { BookNotice: "BookNotice" },
    "./useAISendingConsent": { useAISendingConsent: () => ({ sendingConsent: null, confirmAISending: () => consent.promise }) },
    "../../platform/settings/aiCatalog": { aiConsentScope: () => needsConsent ? "pending" : "approved" },
    "../../platform/aiConfig": {
      loadAIServiceCatalog: () => { const read = deferred<any>(); reads.push(read); return read.promise; },
      selectAIService: async (...args: any[]) => { selects.push(args); if (waitMutation) await mutation.promise; },
      removeAIService: async (...args: any[]) => { removes.push(args); if (waitMutation) await mutation.promise; },
    },
    "expo-router": { useFocusEffect: (callback: any) => h.react.useEffect(() => focused ? callback() : undefined, [callback, focused]) },
  })("apps/mobile/src/ui/settings/AISettingsScreen.tsx").AISettingsScreen;
  return {
    render: () => h.render(() => Screen({ onBack() {}, onEditService(id: string) { edits.push(id); } })),
    reads, selects, removes, edits, consent, mutation,
    needConsent() { needsConsent = true; }, waitMutation() { waitMutation = true; },
    blur() { focused = false; }, focus() { focused = true; }, unmount: h.unmount,
  };
}
const list = (tree: any) => nodes(tree, (n) => n.type === "ServiceList")[0];
const notice = (tree: any) => nodes(tree, (n) => n.type === "BookNotice")[0];
const row = (tree: any, title: string) => nodes(tree, (n) => n.type === "SettingsRow" && n.props.title === title)[0];
async function loaded(h: ReturnType<typeof settings>, name = "saved") { h.render(); h.reads[0]!.resolve(catalog(name)); await flush(); return h.render(); }

test("a delayed settings refresh cannot replace a newer catalog after returning from editing", async () => {
  const h = settings(); h.render(); h.blur(); h.render(); h.focus(); h.render();
  h.reads[1]!.resolve(catalog("new")); await flush();
  h.reads[0]!.resolve(catalog("old")); await flush();
  assert.equal(list(h.render()).props.services[0].name, "new"); h.unmount();
});
test("obsolete settings failures cannot clear a newer catalog or finish its loading state", async () => {
  const h = settings(); await loaded(h);
  h.blur(); h.render(); h.focus(); h.render(); h.blur(); h.render(); h.focus(); h.render();
  h.reads[1]!.reject(new Error("obsolete read")); await flush();
  let tree = h.render(); assert.equal(list(tree).props.services[0].name, "saved"); assert.equal(list(tree).props.disabled, true); assert.equal(row(tree, "obsolete read"), undefined);
  h.reads[2]!.resolve(catalog("latest")); await flush();
  tree = h.render(); assert.equal(list(tree).props.services[0].name, "latest"); assert.equal(list(tree).props.disabled, false); h.unmount();
});
test("blurred or unmounted settings reads publish no late errors", async () => {
  for (const unmount of [false, true]) {
    const h = settings(); await loaded(h); h.blur(); h.render(); h.focus(); h.render();
    if (unmount) h.unmount(); else { h.blur(); h.render(); }
    h.reads[1]!.reject(new Error("late hidden failure")); await flush();
    assert.equal(list(h.render()).props.services[0].name, "saved"); assert.equal(row(h.render(), "late hidden failure"), undefined);
    if (!unmount) h.unmount();
  }
});
test("selection locks edits, additions, removals and repeated taps until persistence completes", async () => {
  const h = settings(); h.waitMutation(); const tree = await loaded(h); const actions = list(tree).props;
  actions.onSelect(service("other")); actions.onSelect(service("third")); actions.onRemove(service("saved")); actions.onAdd(); actions.onEdit(service("saved"));
  assert.deepEqual(h.selects, [["other", true]]); assert.deepEqual(h.edits, []); assert.deepEqual(h.removes, []); assert.equal(list(h.render()).props.disabled, true);
  h.mutation.resolve(); await flush(); h.reads[1]!.resolve(catalog("other")); await flush();
  assert.equal(list(h.render()).props.selectedId, "other"); assert.equal(list(h.render()).props.disabled, false); h.unmount();
});
test("consent settled after blur or unmount cannot select a service", async () => {
  for (const unmount of [false, true]) {
    const h = settings(); h.needConsent(); const tree = await loaded(h); list(tree).props.onSelect(service("other"));
    if (unmount) h.unmount(); else { h.blur(); h.render(); h.focus(); h.render(); }
    h.consent.resolve(true); await flush(); assert.deepEqual(h.selects, []); if (!unmount) h.unmount();
  }
});
test("returning during an accepted write refreshes again when persistence completes", async () => {
  const h = settings(); h.waitMutation(); const tree = await loaded(h);
  list(tree).props.onSelect(service("other"));
  h.blur(); h.render(); h.focus(); h.render();
  h.reads[1]!.resolve(catalog("saved")); await flush();
  h.mutation.resolve(); await flush();
  h.reads[2]!.resolve(catalog("other")); await flush();
  assert.equal(list(h.render()).props.selectedId, "other");
  assert.equal(list(h.render()).props.disabled, false); h.unmount();
});
test("cancelled, stale and blurred deletion notices never remove a service", async () => {
  const h = settings(); let tree = await loaded(h); list(tree).props.onRemove(service("saved"));
  const old = notice(h.render()); old.props.actions[0].onPress(); old.props.actions[1].onPress(); await flush(); assert.deepEqual(h.removes, []);
  list(h.render()).props.onRemove(service("saved")); const hidden = notice(h.render()); h.blur(); h.render(); hidden.props.actions[1].onPress(); await flush();
  assert.deepEqual(h.removes, []); h.unmount();
});
test("deleting the selected service runs once and publishes the platform's empty selection", async () => {
  const h = settings(); const tree = await loaded(h); list(tree).props.onRemove(service("saved"));
  const confirm = notice(h.render()); confirm.props.actions[1].onPress(); confirm.props.actions[1].onPress(); await flush();
  assert.deepEqual(h.removes, [["saved"]]); assert.deepEqual(h.selects, []);
  h.reads[1]!.resolve({ version: 2, selectedId: null, services: [service("other")] }); await flush();
  assert.equal(list(h.render()).props.selectedId, null); assert.equal(list(h.render()).props.services[0].id, "other"); h.unmount();
});
test("mutation failure is visible and retry reloads without inventing selection", async () => {
  const h = settings(); h.waitMutation(); const tree = await loaded(h); list(tree).props.onSelect(service("other"));
  h.mutation.reject(new Error("storage failed")); await flush();
  const failed = h.render(); assert.ok(row(failed, "storage failed")); assert.equal(list(failed).props.selectedId, "saved");
  row(failed, "storage failed").props.onPress(); h.reads[1]!.resolve(catalog("saved")); await flush();
  assert.equal(list(h.render()).props.disabled, false); h.unmount();
});
