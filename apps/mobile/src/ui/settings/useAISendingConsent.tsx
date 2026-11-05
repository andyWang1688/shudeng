import { useCallback, useEffect, useRef, useState } from "react";
import type { AIServiceDraft } from "../../platform/aiConfig";
import { BookNotice } from "../components/BookNotice";

type ConsentRequest = {
  readonly id: number;
  readonly message: string;
  readonly action: string;
  readonly resolve: (allowed: boolean) => void;
};

/** Same notice as AIPrivacyController.sendNotice; no path, key or query is displayed. */
export function aiSendingNotice(service: Pick<AIServiceDraft, "name" | "baseUrl">): string {
  return "问题、相关原文和必要对话将发送到“" + service.name + "”（" + new URL(service.baseUrl).hostname + "），可能产生服务费用。";
}

/** A screen owns its consent request. It can never outlive that screen or be
 * resolved by a button retained from an earlier card. BookNotice invokes an
 * action only after its native Modal.onDismiss has completed. */
export function useAISendingConsent() {
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const pending = useRef<ConsentRequest | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    setRequest(null);
    return () => {
      mounted.current = false;
      const abandoned = pending.current;
      pending.current = null;
      abandoned?.resolve(false);
    };
  }, []);

  const confirmAISending = useCallback((service: Pick<AIServiceDraft, "name" | "baseUrl">, action: string): Promise<boolean> => {
    // Do not replace a visible request with a duplicate invocation.
    if (!mounted.current || pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { id: ++sequence.current, message: aiSendingNotice(service), action, resolve };
      pending.current = next;
      setRequest(next);
    });
  }, []);
  const settle = useCallback((current: ConsentRequest, allowed: boolean) => {
    if (!mounted.current || pending.current !== current) return;
    pending.current = null;
    setRequest(null);
    current.resolve(allowed);
  }, []);
  const sendingConsent = request ? (
    <BookNotice
      key={request.id}
      title="AI 服务发送说明"
      message={request.message}
      actions={[
        { title: "取消", style: "cancel", onPress: () => settle(request, false) },
        { title: request.action, onPress: () => settle(request, true) },
      ]}
    />
  ) : null;
  return { confirmAISending, sendingConsent };
}
