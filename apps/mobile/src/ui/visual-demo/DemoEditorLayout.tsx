import type { ReactElement, ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { demoColors as c } from "./demoTheme";

export type DemoEditorLayoutProps = {
  title: string;
  onLeadingAction: () => void;
  leadingIsBack: boolean;
  onSave?: () => void;
  fallbackHeader: ReactNode;
  children: ReactElement;
};

export function DemoEditorLayout({
  fallbackHeader,
  children,
}: DemoEditorLayoutProps) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.paper }}
      edges={["top", "bottom"]}
    >
      {fallbackHeader}
      {children}
    </SafeAreaView>
  );
}
