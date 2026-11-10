import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  preferences: { instructions: "先查原文，再解释。" },
  config: {
    id: "service-a",
    provider: "openai",
    model: "gpt-4.1",
    apiKey: "synthetic-test-key",
    baseUrl: "https://api.openai.com/v1",
    webSearchEnabled: false,
  },
  preferenceError: null as Error | null,
  toolGate: null as Promise<unknown[]> | null,
  models: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
}));
vi.mock("@shudeng/core/agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@shudeng/core/agent")>(),
  createChatModel: (config: Record<string, unknown>) => {
    state.models.push(config);
    return config;
  },
  runBookAgent: (options: Record<string, unknown>) => {
    state.runs.push(options);
    return { events: [], result: Promise.resolve({}), cancel() {} };
  },
}));
vi.mock("../../aiConfig", () => ({
  loadAIConfig: async () => ({ ...state.config }),
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("../../db", () => ({
  getDataLayer: async () => ({
    store: {
      getBook: async () => ({
        id: "book",
        title: "原书",
        format: "epub",
        sourceHash: "hash",
        removedAt: null,
      }),
    },
  }),
}));
vi.mock("../../assistantPreferences", () => ({
  loadAssistantPreferences: async () => {
    if (state.preferenceError) throw state.preferenceError;
    return { ...state.preferences };
  },
}));
vi.mock("../../mcp", () => ({
  loadMCPAgentTools: async () => state.toolGate ?? [],
}));
vi.mock("../legacyIndex", () => ({
  createLegacyBookSource: vi.fn(),
  getLegacyIndexStatus: vi.fn(),
}));
vi.mock("../bookIndex", () => ({
  getLocalBookIndexStatus: async () => ({
    available: true,
    semantic: true,
    detail: "已准备",
  }),
  createLocalBookSource: async () => ({ search: async () => [] }),
  rebuildBookIndex: vi.fn(),
}));
import { startBookChatTurn } from "../bookChat";

beforeEach(() => {
  state.models = [];
  state.runs = [];
  state.preferenceError = null;
  state.toolGate = null;
  state.preferences = { instructions: "先查原文，再解释。" };
  state.config = {
    id: "service-a",
    provider: "openai",
    model: "gpt-4.1",
    apiKey: "synthetic-test-key",
    baseUrl: "https://api.openai.com/v1",
    webSearchEnabled: false,
  };
});

describe("product agent preference snapshots", () => {
  it("applies saved instructions and provider search only to the answer model, with matching output budget", async () => {
    state.preferences = { instructions: "# 我的读书助手\n回答请简短。" };
    state.config.webSearchEnabled = true;
    await startBookChatTurn({
      bookId: "book",
      question: "这一段是什么意思？",
      selectionQuote: "选中的原文",
    });
    expect(state.models[0]).toMatchObject({
      maxTokens: 4096,
      webSearch: { enabled: true, maxUses: 3 },
    });
    expect(state.models[1]).not.toHaveProperty("webSearch");
    expect(state.runs[0]).toMatchObject({
      assistantInstructions: state.preferences.instructions,
      selectionQuote: "选中的原文",
      outputReserveTokens: 4096,
      book: { id: "book" },
    });
  });

  it("keeps an in-flight preference snapshot and picks up changes on the next question", async () => {
    let release!: (tools: unknown[]) => void;
    state.toolGate = new Promise((resolve) => {
      release = resolve;
    });
    const first = startBookChatTurn({ bookId: "book", question: "第一个问题" });
    await vi.waitFor(() => expect(state.models).toHaveLength(2));
    state.preferences = { instructions: "新的性格与行为" };
    state.config = { ...state.config, id: "service-b", webSearchEnabled: true };
    release([]);
    await first;
    expect(state.runs[0]!.assistantInstructions).toBe("先查原文，再解释。");
    expect(state.models[0]!.webSearch).toEqual({ enabled: false, maxUses: 3 });
    state.toolGate = null;
    await startBookChatTurn({ bookId: "book", question: "第二个问题" });
    expect(state.runs[1]!.assistantInstructions).toBe("新的性格与行为");
    expect(state.models[2]!.webSearch).toEqual({ enabled: true, maxUses: 3 });
  });

  it("does not use a historical global switch as a fallback for another service", async () => {
    Object.assign(state.preferences, {
      webSearchEnabled: true,
      legacyWebSearchEnabled: true,
    });
    state.config.webSearchEnabled = false;
    await startBookChatTurn({ bookId: "book", question: "只查书内内容" });
    expect(state.models[0]!.webSearch).toEqual({ enabled: false, maxUses: 3 });
  });

  it("surfaces unreadable preference data before making a model request", async () => {
    state.preferenceError = new Error("助手配置已损坏");
    await expect(
      startBookChatTurn({ bookId: "book", question: "问题" }),
    ).rejects.toThrow("助手配置已损坏");
    expect(state.models).toEqual([]);
    expect(state.runs).toEqual([]);
  });

  it("uses bundled input metadata automatically rather than a provider-wide default", async () => {
    await startBookChatTurn({ bookId: "book", question: "问题" });
    expect(state.runs[0]!.contextWindowTokens).toBe(1_047_576);
  });

  it.each([1_000_000, 1_047_576, 2_000_000, Number.MAX_SAFE_INTEGER])(
    "keeps saved manual window %i in the real agent budget", async (size) => {
      Object.assign(state.config, { contextWindowTokens: size });
      await startBookChatTurn({ bookId: "book", question: "问题" });
      expect(state.runs[0]!.contextWindowTokens).toBe(size);
    },
  );

  it("gives the per-turn override precedence and fits output to a small window", async () => {
    Object.assign(state.config, { contextWindowTokens: 1_047_576 });
    await startBookChatTurn({ bookId: "book", question: "问题", contextWindowTokens: 1000 });
    expect(state.runs[0]).toMatchObject({ contextWindowTokens: 1000, outputReserveTokens: 500 });
    expect(state.models.map(model => model.maxTokens)).toEqual([500, 500]);
  });

  it("uses explicit fallback for an unknown custom DeepSeek model with matching thinking output reserve", async () => {
    Object.assign(state.config, { model: "deepseek-private", baseUrl: "https://gateway.example/v1" });
    await startBookChatTurn({ bookId: "book", question: "问题" });
    expect(state.runs[0]).toMatchObject({ contextWindowTokens: 32768, outputReserveTokens: 16384 });
    expect(state.models[0]!.maxTokens).toBe(16384);
  });

  it.each([NaN, Infinity, 999, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid per-turn window %s before creating models or dispatching", async (size) => {
      await expect(startBookChatTurn({ bookId: "book", question: "问题", contextWindowTokens: size })).rejects.toThrow("安全整数");
      expect(state.models).toEqual([]);
      expect(state.runs).toEqual([]);
    },
  );
});
