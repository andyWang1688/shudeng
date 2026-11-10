import type { ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePalette } from "../theme";

export type SettingsEditorLayoutProps = {
  title: string;
  onLeadingAction: () => void;
  leadingIsBack?: boolean;
  onSave?: () => void;
  saveDisabled?: boolean;
  fallbackHeader: ReactNode;
  nativeContent?: ReactNode;
  children: ReactNode;
};

export function SettingsEditorLayout({
  fallbackHeader,
  children,
}: SettingsEditorLayoutProps) {
  const p = usePalette();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: p.paper }}
      edges={["top", "left", "right", "bottom"]}
    >
      {fallbackHeader}
      {children}
    </SafeAreaView>
  );
}
