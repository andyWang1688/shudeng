import { useCallback, useEffect, useRef, useState } from "react";
import { registerMCPToolConsentPresenter, type MCPToolConsentPrompt, type MCPToolConsentScope } from "../../platform/settings/mcpToolConsent";
import { BookNotice } from "../components/BookNotice";

type ConsentRequest = {
  readonly id: number;
  readonly prompt: MCPToolConsentPrompt;
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
  readonly resolve: (granted: boolean) => void;
};

/** Root fallback or focused screen host. Losing its presentation lease rejects
 * only the pending confirmation, even if the native Modal is still closing. */
export function MCPToolConsentHost({ active = true, scope = "fallback", depth = 0 }: {
  readonly active?: boolean;
  readonly scope?: MCPToolConsentScope;
  readonly depth?: number;
} = {}) {
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const pending = useRef<ConsentRequest | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const settle = useCallback((current: ConsentRequest, granted: boolean) => {
    if (pending.current !== current) return;
    pending.current = null;
    current.signal?.removeEventListener("abort", current.abort);
    if (mounted.current) setRequest(null);
    current.resolve(granted && mounted.current && !current.signal?.aborted);
  }, []);
  useEffect(() => {
    if (!active) return;
    mounted.current = true;
    setRequest(null);
    const unregister = registerMCPToolConsentPresenter((prompt, signal) => {
      if (!mounted.current || pending.current || signal?.aborted) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const next: ConsentRequest = {
          id: ++sequence.current, prompt, signal, resolve,
          abort: () => settle(next, false),
        };
        pending.current = next;
        signal?.addEventListener("abort", next.abort, { once: true });
        if (signal?.aborted) settle(next, false);
        else setRequest(next);
      });
    }, scope, depth);
    return () => {
      mounted.current = false;
      unregister();
      if (pending.current) settle(pending.current, false);
    };
  }, [active, depth, scope, settle]);
  return request && active && pending.current === request ? (
    <BookNotice
      key={request.id}
      title={request.prompt.title}
      message={request.prompt.message}
      actions={[
        { title: "允许一次", onPress: () => settle(request, true) },
        { title: "取消", style: "cancel", onPress: () => settle(request, false) },
      ]}
    />
  ) : null;
}
