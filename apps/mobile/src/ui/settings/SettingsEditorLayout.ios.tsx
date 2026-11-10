import {
  Button,
  Host,
  NavigationStack,
  RNHostView,
  Toolbar,
  ToolbarItem,
} from "@expo/ui/swift-ui";
import { View } from "react-native";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  labelStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useAppearance } from "../appearance";
import { usePalette } from "../theme";
import type { SettingsEditorLayoutProps } from "./SettingsEditorLayout";

/** Native navigation chrome; fields, saving and consent retain their screen owners. */
export function SettingsEditorLayout({
  title,
  onLeadingAction,
  leadingIsBack,
  onSave,
  saveDisabled = false,
  nativeContent,
  children,
}: SettingsEditorLayoutProps) {
  const p = usePalette();
  const { resolvedMode } = useAppearance();
  const leadingLabel = leadingIsBack ? "返回" : "取消";
  return (
    <Host style={{ flex: 1 }} colorScheme={resolvedMode} seedColor={p.lampInk}>
      <NavigationStack>
        <Toolbar
          modifiers={[
            navigationTitle(title),
            navigationBarTitleDisplayMode("inline"),
            ...(nativeContent ? [] : [background(p.paper)]),
          ]}
        >
          {nativeContent ?? (
            <RNHostView>
              <View style={{ flex: 1 }}>{children}</View>
            </RNHostView>
          )}
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
                  tint(p.ink2),
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
                    disabled(saveDisabled),
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
