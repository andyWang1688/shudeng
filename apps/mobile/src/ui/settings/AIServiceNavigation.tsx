import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "expo-router";

type AISettingsReturnTo = "/ai-settings" | "/book-chat/ai-settings";
interface AIServiceNavigation {
  readonly returnTo: AISettingsReturnTo;
  readonly closeEditor: () => void;
}
const NavigationContext = createContext<AIServiceNavigation | null>(null);

/** Capture the presenting route once; advanced pushes must not change the return destination. */
export function AIServiceNavigationProvider({
  returnTo,
  children,
}: {
  readonly returnTo: string | string[] | undefined;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const [destination] = useState<AISettingsReturnTo>(() => {
    const requested = Array.isArray(returnTo) ? returnTo[0] : returnTo;
    return requested === "/book-chat/ai-settings" ? requested : "/ai-settings";
  });
  const value = useMemo(
    () => ({
      returnTo: destination,
      closeEditor: () => router.dismissTo(destination),
    }),
    [destination, router],
  );
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useAIServiceNavigation(): AIServiceNavigation {
  const value = useContext(NavigationContext);
  if (!value)
    throw new Error("AI service navigation requires its modal context.");
  return value;
}
