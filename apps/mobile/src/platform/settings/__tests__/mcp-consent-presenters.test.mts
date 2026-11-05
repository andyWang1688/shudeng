import assert from "node:assert/strict";
import test from "node:test";
import { registerMCPToolConsentPresenter, requestMCPToolConsent } from "../mcpToolConsent.ts";

const prompt = { title: "调用外部工具？", message: "Public lifecycle fixture" };

test("closing the focused screen restores the live fallback presenter", async () => {
  const shown: string[] = [];
  const root = registerMCPToolConsentPresenter(async () => { shown.push("root"); return false; }, "fallback");
  const screen = registerMCPToolConsentPresenter(async () => { shown.push("screen"); return false; }, "screen");
  try {
    await requestMCPToolConsent(prompt);
    assert.deepEqual(shown, ["screen"]);
    screen();
    await requestMCPToolConsent(prompt);
    assert.deepEqual(shown, ["screen", "root"]);
  } finally { screen(); root(); }
  assert.equal(await requestMCPToolConsent(prompt), false);
});

test("a new focused screen cannot inherit an invisible fallback request", async () => {
  let oldAllow: ((value: boolean) => void) | undefined;
  const root = registerMCPToolConsentPresenter(() => new Promise(resolve => { oldAllow = resolve; }), "fallback");
  const pending = requestMCPToolConsent(prompt);
  const screen = registerMCPToolConsentPresenter(async () => false, "screen");
  try {
    const outcome = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve("still pending")))]);
    assert.equal(outcome, false);
    oldAllow?.(true);
    assert.equal(await requestMCPToolConsent(prompt), false);
  } finally { oldAllow?.(false); screen(); root(); }
});

test("the nested visible screen wins even when ancestor and fallback effects register later", async () => {
  const shown: string[] = [];
  const leaf = registerMCPToolConsentPresenter(async () => { shown.push("leaf"); return false; }, "screen", 2);
  const ancestor = registerMCPToolConsentPresenter(async () => { shown.push("ancestor"); return false; }, "screen", 1);
  const root = registerMCPToolConsentPresenter(async () => { shown.push("root"); return false; }, "fallback");
  try {
    await requestMCPToolConsent(prompt);
    assert.deepEqual(shown, ["leaf"]);
    ancestor(); ancestor();
    await requestMCPToolConsent(prompt);
    assert.deepEqual(shown, ["leaf", "leaf"]);
    leaf();
    await requestMCPToolConsent(prompt);
    assert.deepEqual(shown, ["leaf", "leaf", "root"]);
  } finally { leaf(); ancestor(); root(); }
});

test("allow followed by lease cleanup in the same turn cannot authorize after the scene changed", async () => {
  let allow!: (granted: boolean) => void;
  const unregister = registerMCPToolConsentPresenter(() => new Promise(resolve => { allow = resolve; }), "screen", 1);
  const pending = requestMCPToolConsent(prompt);
  allow(true); unregister();
  assert.equal(await pending, false);
  assert.equal(await requestMCPToolConsent(prompt), false);
});

test("Agent Abort arriving after allow but before bridge settlement still denies", async () => {
  let allow!: (granted: boolean) => void;
  const abort = new AbortController();
  const unregister = registerMCPToolConsentPresenter(() => new Promise(resolve => { allow = resolve; }), "screen", 1);
  try {
    const pending = requestMCPToolConsent(prompt, abort.signal);
    allow(true); abort.abort();
    assert.equal(await pending, false);
  } finally { unregister(); }
});

test("route cleanup rejects only the presentation lease and never aborts the Agent signal", async () => {
  const run = new AbortController(); let presentation: AbortSignal | undefined;
  const unregister = registerMCPToolConsentPresenter((_prompt, signal) => {
    presentation = signal; return new Promise(() => {});
  }, "screen", 1);
  const pending = requestMCPToolConsent(prompt, run.signal);
  unregister();
  assert.equal(await pending, false);
  assert.equal(presentation?.aborted, true);
  assert.equal(run.signal.aborted, false);
});
