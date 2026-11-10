const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRuntime, act } = require("./support/appearance-runtime.cjs");
const LIGHT = "#FAF9F6",
  DARK = "#1B1A17";
const statePatch = {
  draft: "未发送的草稿",
  selection: { start: 2, end: 5 },
  selectionConsumed: true,
  initialQuestionConsumed: true,
  scroll: { offset: 438, anchorId: "answer-1", anchorOffset: -22 },
  expandedSelection: ["user-1"],
  expandedReasoning: ["answer-1"],
  expandedTools: ["answer-1"],
  reasoningStatus: { "answer-1": "done" },
  reasoningManual: ["answer-1"],
  sheetDetent: 1,
  referenceFocus: "answer-1:E2",
  restoreReferenceFocus: false,
};

test("PDF stays on one presentation through live app changes, close/reopen and duplicate taps", async () => {
  const h = createRuntime();
  try {
    await h.mount();
    await h.ask();
    const original = h.presentation,
      conversationId = original.conversationId,
      origin = original.origin;
    assert.deepEqual(original.appearance, { kind: "application" });
    assert.equal(h.palette().paper, LIGHT);
    await act(() => original.update(statePatch));
    const snapshot = original.getSnapshot();
    await h.mode("dark");
    assert.equal(h.palette().paper, DARK);
    assert.equal(h.presentation, original);
    assert.deepEqual(original.getSnapshot(), snapshot);
    await h.mode("light");
    assert.equal(h.palette().paper, LIGHT);
    await h.back();
    await h.mode("dark");
    await h.ask(undefined, 2);
    assert.equal(
      h.stack.routes.filter((route) => route.name === "book-chat").length,
      1,
    );
    assert.equal(h.presentation, original);
    assert.equal(h.presentation.conversationId, conversationId);
    assert.equal(h.presentation.origin, origin);
    assert.deepEqual(origin, { type: "pdf", page: 41 });
    assert.deepEqual(original.getSnapshot(), {
      ...snapshot,
      restoreReferenceFocus: true,
    });
    assert.equal(h.palette().paper, DARK);
    assert.equal(h.stack.routes.at(-1).params.appearance, "application");
    assert.equal(Object.hasOwn(h.stack.routes.at(-1).params, "theme"), false);
    await h.params({ appearance: "reader", theme: "light" });
    assert.equal(
      h.palette().paper,
      DARK,
      "registered presentation wins over stale route params",
    );
    assert.equal(h.presentation, original);
    await h.back();
    await h.ask({ quote: "新的 PDF 选文", locator: { type: "pdf", page: 42 } });
    assert.notEqual(h.presentation, original);
    assert.notEqual(h.presentation.conversationId, conversationId);
    assert.deepEqual(h.presentation.origin, { type: "pdf", page: 42 });
    assert.equal(h.palette().paper, DARK);
  } finally {
    await h.close();
  }
});

test("PDF citation/return deduplicates and keeps origin/state while following the current app mode", async () => {
  const h = createRuntime();
  try {
    await h.mount();
    await h.ask();
    const original = h.presentation;
    await act(() => original.update(statePatch));
    await h.citation(
      {
        locator: { type: "pdf", page: 50 },
        quote: "引用",
        ordinal: 2,
        id: "E2",
      },
      true,
    );
    assert.equal(h.navigated.length, 1);
    assert.equal(h.locator.page, 50);
    await h.mode("dark");
    await h.returned(true);
    assert.equal(
      h.stack.routes.filter((route) => route.name === "book-chat").length,
      1,
    );
    assert.equal(h.presentation, original);
    assert.deepEqual(original.origin, { type: "pdf", page: 41 });
    assert.equal(
      h.navigated.length,
      1,
      "PDF return keeps citation page without restoring origin",
    );
    assert.equal(h.flushes, 0);
    assert.equal(h.palette().paper, DARK);
    assert.deepEqual(original.getSnapshot(), {
      ...statePatch,
      restoreReferenceFocus: true,
    });
    await h.mode("light");
    assert.equal(h.palette().paper, LIGHT);
  } finally {
    await h.close();
  }
});

test("EPUB keeps its dark reader policy and origin contract while new selection starts a new presentation", async () => {
  const h = createRuntime({ format: "epub" });
  try {
    await h.mount();
    await h.ask();
    const original = h.presentation;
    assert.deepEqual(original.appearanceParams(), {
      appearance: "reader",
      theme: "dark",
    });
    assert.equal(h.palette().paper, DARK);
    await h.mode("dark");
    await h.mode("light");
    assert.equal(h.palette().paper, DARK);
    await h.params({ appearance: "application", theme: "light" });
    assert.equal(h.palette().paper, DARK);
    const target = {
      locator: { type: "epub", cfi: "epubcfi(/6/8!/4)" },
      quote: "引用",
      ordinal: 1,
      id: "E1",
    };
    await h.citation(target, true);
    assert.equal(h.navigated.length, 1);
    await h.ask(undefined, 2);
    assert.equal(h.presentation, original);
    assert.equal(
      h.navigated.length,
      1,
      "bottom ask preserves citation location",
    );
    await h.back();
    await h.returned();
    assert.equal(h.presentation, original);
    assert.equal(h.navigated.length, 2);
    assert.deepEqual(h.navigated[1].locator, original.origin);
    assert.equal(h.navigated[1].citation, false);
    assert.equal(h.flushes, 2);
    await h.back();
    await h.ask({ quote: "新的选文", locator: target.locator });
    assert.notEqual(h.presentation, original);
    assert.notEqual(h.presentation.conversationId, original.conversationId);
    assert.deepEqual(h.presentation.origin, target.locator);
    assert.equal(h.presentation.selectionQuote, "新的选文");
    assert.equal(h.palette().paper, DARK);
  } finally {
    await h.close();
  }
});

test("the actual ReaderAssistantThread composer keeps its draft through theme, materials and close/reopen", async () => {
  const h = createRuntime();
  try {
    await h.mount();
    await h.ask();
    const original = h.presentation;
    await h.editDraft("未发送的多行草稿\n请结合原文解释");
    assert.equal(
      original.getSnapshot().draft,
      "未发送的多行草稿\n请结合原文解释",
    );
    assert.equal(h.draft(), original.getSnapshot().draft);
    assert.equal(
      h.sent.length,
      0,
      "editing the runtime composer never sends a question",
    );
    await h.mode("dark");
    assert.equal(h.draft(), original.getSnapshot().draft);
    await h.openMaterials();
    await h.back();
    assert.equal(h.draft(), original.getSnapshot().draft);
    await h.back();
    await h.ask();
    assert.equal(h.presentation, original);
    assert.equal(h.draft(), "未发送的多行草稿\n请结合原文解释");
    assert.equal(h.sent.length, 0);
  } finally {
    await h.close();
  }
});

test("the actual history composer restores an unsent draft into a new presentation without sending", async () => {
  const h = createRuntime();
  try {
    await h.mount();
    await h.openHistory("saved-conversation");
    const old = h.presentation;
    await h.editDraft("历史里的未发送追问");
    await h.back();
    await h.openHistory("saved-conversation");
    assert.notEqual(h.presentation.id, old.id);
    assert.equal(h.registry.get(old.id), undefined);
    assert.equal(h.draft(), "历史里的未发送追问");
    assert.equal(h.presentation.initialQuestion, undefined);
    assert.equal(h.sent.length, 0);
    await h.editDraft("");
    await h.back();
    await h.openHistory("saved-conversation");
    assert.equal(h.draft(), "");
    await h.back();
    await h.openHistory("another-conversation");
    assert.equal(h.draft(), "");
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

for (const format of ["pdf", "epub"])
  test(
    format +
      " actual ReaderAssistantFooter button passes its policy to an already-open materials page",
    async () => {
      const h = createRuntime({ format });
      try {
        await h.mount();
        await h.ask();
        const original = h.presentation;
        await h.openMaterials();
        const route = h.stack.routes.at(-1);
        assert.equal(route.name, "book-chat/materials");
        assert.equal(route.params.conversationId, original.conversationId);
        assert.equal(route.params.turnId, "answer-1");
        assert.deepEqual(route.params, {
          conversationId: original.conversationId,
          turnId: "answer-1",
          ...original.appearanceParams(),
        });
        const initialId = h.find(
          "StackScreen",
          (record) => record.routeKey === route.key,
        ).id;
        assert.equal(h.materialsPaper(), format === "pdf" ? LIGHT : DARK);
        await h.mode("dark");
        assert.equal(h.materialsPaper(), DARK);
        await h.mode("light");
        assert.equal(h.materialsPaper(), format === "pdf" ? LIGHT : DARK);
        assert.equal(
          h.find("StackScreen", (record) => record.routeKey === route.key).id,
          initialId,
          "theme change updates the mounted materials page",
        );
        assert.equal(
          h.loads.length,
          1,
          "app mode does not reload saved materials",
        );
        assert.equal(h.presentation, original);
      } finally {
        await h.close();
      }
    },
  );

for (const [name, policy, first, second] of [
  [
    "application policy after registry loss",
    { appearance: "application", theme: "light" },
    LIGHT,
    DARK,
  ],
  ["old theme-only link", { theme: "dark" }, DARK, DARK],
  ["old light theme-only link", { theme: "light" }, LIGHT, LIGHT],
  [
    "unknown policy with a legacy theme",
    { appearance: "future", theme: "dark" },
    DARK,
    DARK,
  ],
  ["missing legacy theme", {}, LIGHT, DARK],
  ["invalid legacy theme", { theme: "invalid" }, LIGHT, DARK],
  [
    "unknown policy without valid theme",
    { appearance: "future", theme: "invalid" },
    LIGHT,
    DARK,
  ],
])
  test(
    name + " preserves route compatibility through chat and materials",
    async () => {
      const h = createRuntime({
        params: {
          bookId: "book",
          conversationId: "saved-conversation",
          questionPresentationId: "lost-token",
          ...policy,
        },
      });
      try {
        await h.mount();
        assert.equal(h.presentation.source, null);
        assert.equal(h.presentation.conversationId, "saved-conversation");
        const original = h.presentation;
        const snapshot = original.getSnapshot();
        assert.equal(h.palette().paper, first);
        await h.mode("dark");
        assert.equal(h.palette().paper, second);
        await h.mode("light");
        assert.equal(h.palette().paper, first);
        await h.mode("dark");
        assert.equal(h.palette().paper, second);
        assert.equal(h.presentation, original);
        assert.deepEqual(original.getSnapshot(), snapshot);
        await h.openMaterials();
        assert.equal(h.materialsPaper(), second);
        await h.mode("light");
        assert.equal(h.materialsPaper(), first);
        await h.mode("dark");
        assert.equal(h.materialsPaper(), second);
      } finally {
        await h.close();
      }
    },
  );

for (const [name, policy, light, dark] of [
  ["missing theme", {}, LIGHT, DARK],
  ["invalid theme", { theme: "invalid" }, LIGHT, DARK],
  [
    "unknown policy and invalid theme",
    { appearance: "future", theme: "invalid" },
    LIGHT,
    DARK,
  ],
  [
    "unknown policy and valid theme",
    { appearance: "future", theme: "dark" },
    DARK,
    DARK,
  ],
  ["fixed light theme", { theme: "light" }, LIGHT, LIGHT],
  ["fixed dark theme", { theme: "dark" }, DARK, DARK],
])
  test(
    "direct legacy materials link with " +
      name +
      " keeps its old appearance contract in both directions",
    async () => {
      const h = createRuntime({
        initialRoute: "book-chat/materials",
        params: { conversationId: "saved", turnId: "answer-1", ...policy },
      });
      try {
        await h.mount();
        const hostId = h.find("StackScreen").id;
        assert.equal(h.materialsPaper(), light);
        await h.mode("dark");
        assert.equal(h.materialsPaper(), dark);
        await h.mode("light");
        assert.equal(h.materialsPaper(), light);
        await h.mode("dark");
        assert.equal(h.materialsPaper(), dark);
        assert.equal(h.find("StackScreen").id, hostId);
        assert.equal(h.loads.length, 1);
      } finally {
        await h.close();
      }
    },
  );
