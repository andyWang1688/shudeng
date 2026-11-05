import type { MCPServer, MCPTool } from "./mcpPolicy";

export interface MCPToolConsentPrompt {
  readonly title: string;
  readonly message: string;
}
type Presenter = (prompt: MCPToolConsentPrompt, signal?: AbortSignal) => Promise<boolean>;
export type MCPToolConsentScope = "fallback" | "screen";
type Registration = { readonly present: Presenter; readonly depth: number };
const presenters: Registration[] = [];
let pending: { readonly owner: Registration; readonly abort: () => void } | null = null;

function currentPresenter(): Registration | undefined {
  let current: Registration | undefined;
  for (const entry of presenters) {
    if (!current || entry.depth >= current.depth) current = entry;
  }
  return current;
}

function cancelHiddenRequest(): void {
  if (pending && pending.owner !== currentPresenter()) pending.abort();
}

/** A UI host supplies presentation. Without one, background work cannot consent. */
export function registerMCPToolConsentPresenter(next: Presenter, scope: MCPToolConsentScope = "fallback", depth = 0): () => void {
  const entry = { present: next, depth: scope === "screen" ? depth : -1 };
  presenters.push(entry);
  cancelHiddenRequest();
  return () => {
    const index = presenters.indexOf(entry);
    if (index >= 0) presenters.splice(index, 1);
    cancelHiddenRequest();
  };
}

/** Text is identical to native MCPToolConfirmationCenter; no headers or args. */
export function mcpToolConsentPrompt(server: Pick<MCPServer, "name">, tool: Pick<MCPTool, "name" | "title">): MCPToolConsentPrompt {
  return {
    title: "调用外部工具？",
    message: "「" + (tool.title || tool.name) + "」由外部服务「" + server.name + "」提供。将只发送本次工具参数，不会发送书库或 AI 密钥。",
  };
}

export function requestMCPToolConsent(prompt: MCPToolConsentPrompt, signal?: AbortSignal): Promise<boolean> {
  const presenter = currentPresenter();
  if (!presenter || signal?.aborted || pending) return Promise.resolve(false);
  // This signal belongs only to the presentation lease. Losing a screen dismisses
  // its confirmation, never the Agent run that supplied the outer signal.
  const controller = new AbortController();
  return new Promise<boolean>(resolve => {
    const settle = (granted: boolean) => {
      if (pending !== request) return;
      pending = null;
      signal?.removeEventListener("abort", request.abort);
      resolve(granted && presenter === currentPresenter() && !controller.signal.aborted && !signal?.aborted);
    };
    const request = { owner: presenter, abort: () => { controller.abort(); settle(false); } };
    pending = request;
    signal?.addEventListener("abort", request.abort, { once: true });
    if (signal?.aborted) { request.abort(); return; }
    try {
      Promise.resolve(presenter.present(prompt, controller.signal)).then(settle, () => settle(false));
    } catch { settle(false); }
  });
}
