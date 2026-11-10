import { createContext, useContext, useState, type ReactNode } from "react";
import type { AIProvider, AIService } from "../../platform/aiConfig";

export const AI_PRESETS: Record<
  AIProvider,
  { name: string; model: string; baseUrl: string }
> = {
  deepseek: {
    name: "DeepSeek",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
  },
  openai: {
    name: "OpenAI",
    model: "gpt-4.1",
    baseUrl: "https://api.openai.com/v1",
  },
  anthropic: {
    name: "Anthropic",
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.anthropic.com",
  },
};
function useDraftState(service: AIService | null, selected: boolean) {
  const [provider, setProvider] = useState<AIProvider>(
    service?.provider ?? "deepseek",
  );
  const [name, setName] = useState(service?.name ?? AI_PRESETS.deepseek.name);
  const [model, setModel] = useState(
    service?.model ?? AI_PRESETS.deepseek.model,
  );
  const [baseUrl, setBaseUrl] = useState(
    service?.baseUrl ?? AI_PRESETS.deepseek.baseUrl,
  );
  const [windowSize, setWindowSize] = useState(
    service?.contextWindowTokens?.toString() ?? "",
  );
  const [manualWindowSize, setManualWindowSize] = useState(windowSize);
  const [windowAutomatic, setWindowAutomatic] = useState(windowSize === "");
  const [key, setKey] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    service?.webSearchEnabled ?? false,
  );
  return {
    service,
    selected,
    provider,
    setProvider: (value: AIProvider) => {
      if (!service) setProvider(value);
    },
    name,
    setName,
    model,
    setModel,
    baseUrl,
    setBaseUrl,
    windowSize,
    setWindowSize,
    manualWindowSize,
    setManualWindowSize,
    windowAutomatic,
    setWindowAutomatic,
    key,
    setKey,
    webSearchEnabled,
    setWebSearchEnabled,
  };
}
const DraftContext = createContext<ReturnType<typeof useDraftState> | null>(
  null,
);
export function AIServiceDraftProvider({
  service,
  selected,
  children,
}: {
  readonly service: AIService | null;
  readonly selected: boolean;
  readonly children: ReactNode;
}) {
  return (
    <DraftContext.Provider value={useDraftState(service, selected)}>
      {children}
    </DraftContext.Provider>
  );
}
export function useAIServiceDraft() {
  const value = useContext(DraftContext);
  if (!value)
    throw new Error("AI service draft requires the editor navigation context.");
  return value;
}
