import { Button, Host, HStack, Image, List, Section, SwipeActions, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, buttonStyle, disabled as isDisabled, font, foregroundStyle, frame, labelStyle, listRowBackground, listStyle, padding, scrollContentBackground, tint } from "@expo/ui/swift-ui/modifiers";
import type { ServiceListProps } from "./ServiceList";
import { usePalette, darkColors } from "../theme";

/** The system owns row hit areas, scrolling and swipe presentation. */
export function ServiceList({ services, selectedId, notice, disabled, onSelect, onEdit, onAdd, onRemove }: ServiceListProps) {
  const p = usePalette();
  return (
    <Host style={{ flex: 1 }} colorScheme={p === darkColors ? "dark" : "light"} seedColor={p.lampInk} ignoreSafeArea="container">
      <List modifiers={[listStyle("insetGrouped"), scrollContentBackground("hidden"), background(p.paper)]}>
        <Section title="当前服务" footer={<Text>{notice}</Text>}>
          <List.ForEach data={[...services]} keyExtractor={(service) => service.id} recycling={false}>
            {({ item: service }) => (
              <SwipeActions modifiers={[listRowBackground(p.surface)]}>
                <HStack spacing={12} modifiers={[padding({ vertical: 8 })]}>
                  <Button onPress={() => onSelect(service)} modifiers={[buttonStyle("plain"), isDisabled(disabled),
                    accessibilityLabel("使用 " + service.name + (service.id === selectedId ? "，已选择" : ""))]}>
                    <HStack spacing={14} modifiers={[frame({ minHeight: 44, maxWidth: Infinity, alignment: "leading" })]}>
                      <Image systemName={service.id === selectedId ? "checkmark.circle.fill" : "circle"} color={service.id === selectedId ? p.lampInk : p.ink2} size={22} />
                      <VStack alignment="leading" spacing={4}>
                        <Text modifiers={[font({ textStyle: "body" }), foregroundStyle(p.ink)]}>{service.name}</Text>
                        <Text modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(p.ink2)]}>{service.model}</Text>
                      </VStack>
                    </HStack>
                  </Button>
                  <Button label="编辑" systemImage="pencil" onPress={() => onEdit(service)} modifiers={[buttonStyle("plain"), labelStyle("iconOnly"), tint(p.ink2), isDisabled(disabled), frame({ minWidth: 44, minHeight: 44 }), accessibilityLabel("编辑 " + service.name)]} />
                </HStack>
                <SwipeActions.Actions allowsFullSwipe={false}>
                  <Button label="删除" systemImage="trash" onPress={() => onRemove(service)} modifiers={[tint(p.error), isDisabled(disabled), accessibilityLabel("删除 " + service.name)]} />
                </SwipeActions.Actions>
              </SwipeActions>
            )}
          </List.ForEach>
          <Button label="添加 AI 服务" systemImage="plus" onPress={onAdd} modifiers={[tint(p.lampInk), listRowBackground(p.surface), isDisabled(disabled), padding({ vertical: 10 })]} />
        </Section>
      </List>
    </Host>
  );
}
