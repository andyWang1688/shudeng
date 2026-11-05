import { createContext, useContext, type ReactNode } from "react";
import { useIsFocused } from "expo-router";
import { MCPToolConsentHost } from "./MCPToolConsentHost";

const ScreenDepth = createContext(0);

/** Render inside the actual route screen, so RN Modal uses that screen's VC. */
export function MCPToolConsentScreenHost() {
  const active = useIsFocused();
  const depth = useContext(ScreenDepth);
  return <MCPToolConsentHost active={active} scope="screen" depth={depth} />;
}

function ConsentScreen({ children }: { readonly children: ReactNode }) {
  const depth = useContext(ScreenDepth) + 1;
  return <ScreenDepth value={depth}><MCPToolConsentScreenHost />{children}</ScreenDepth>;
}

/** Stack screenLayout wraps every native scene, including nested settings pages. */
export function mcpToolConsentScreenLayout({ children }: { readonly children: ReactNode }) {
  return <ConsentScreen>{children}</ConsentScreen>;
}
