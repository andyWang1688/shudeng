import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type TabInteraction = {
  readonly locked: boolean;
  readonly acquire: () => () => void;
};
const TabInteractionContext = createContext<TabInteraction | null>(null);

/** A blocking import keeps its picker, confirmation and progress in one navigation stack. */
export function TabInteractionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [locks, setLocks] = useState(0);
  const acquire = useCallback(() => {
    setLocks((value) => value + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setLocks((value) => Math.max(0, value - 1));
    };
  }, []);
  const value = useMemo(
    () => ({ locked: locks > 0, acquire }),
    [locks, acquire],
  );
  return (
    <TabInteractionContext.Provider value={value}>
      {children}
    </TabInteractionContext.Provider>
  );
}

export function useTabInteractionLocked(): boolean {
  return useContext(TabInteractionContext)?.locked ?? false;
}

export function useTabInteractionLock(locked: boolean): void {
  const acquire = useContext(TabInteractionContext)?.acquire;
  useLayoutEffect(
    () => (locked && acquire ? acquire() : undefined),
    [locked, acquire],
  );
}
