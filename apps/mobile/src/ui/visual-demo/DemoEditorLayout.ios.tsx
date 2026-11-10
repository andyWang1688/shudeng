import {
  Button,
  Host,
  NavigationStack,
  RNHostView,
  Toolbar,
  ToolbarItem,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  labelStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { DemoEditorLayoutProps } from "./DemoEditorLayout";
import { demoColors as c } from "./demoTheme";

/** Native navigation chrome owns the editor's title, spacing and action presentation. */
export function DemoEditorLayout({
  title,
  onLeadingAction,
  leadingIsBack,
  onSave,
  children,
}: DemoEditorLayoutProps) {
  const leadingLabel = leadingIsBack ? "返回" : "取消";
  return (
    <Host style={{ flex: 1 }} colorScheme="light" seedColor={c.accent}>
      <NavigationStack>
        <Toolbar
          modifiers={[
            navigationTitle(title),
            navigationBarTitleDisplayMode("inline"),
            background(c.paper),
          ]}
        >
          <RNHostView>{children}</RNHostView>
          <Toolbar.Content>
            <ToolbarItem
              placement={leadingIsBack ? "navigation" : "cancellationAction"}
            >
              <Button
                label={leadingLabel}
                systemImage={leadingIsBack ? "chevron.left" : "xmark"}
                onPress={onLeadingAction}
                modifiers={[
                  labelStyle("iconOnly"),
                  accessibilityLabel(leadingLabel),
                  tint(c.secondary),
                ]}
              />
            </ToolbarItem>
            {onSave && (
              <ToolbarItem placement="confirmationAction">
                <Button
                  label="保存"
                  systemImage="checkmark"
                  onPress={onSave}
                  modifiers={[
                    labelStyle("iconOnly"),
                    buttonStyle("borderedProminent"),
                    accessibilityLabel("保存"),
                  ]}
                />
              </ToolbarItem>
            )}
          </Toolbar.Content>
        </Toolbar>
      </NavigationStack>
    </Host>
  );
}
