import {
  Button,
  Host,
  HStack,
  Image,
  List,
  Section,
  SwipeActions,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  listRowBackground,
  listStyle,
  padding,
  scrollContentBackground,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { DemoServiceListProps } from "./DemoServiceList";
import { demoColors as c } from "./demoTheme";

/** System List owns selection hit areas and destructive swipe presentation. */
export function DemoServiceList({
  services,
  selectedId,
  notice,
  onSelect,
  onEdit,
  onAdd,
  onRemove,
}: DemoServiceListProps) {
  return (
    <Host
      style={{ flex: 1 }}
      colorScheme="light"
      seedColor={c.accent}
      ignoreSafeArea="container"
    >
      <List
        modifiers={[
          listStyle("insetGrouped"),
          scrollContentBackground("hidden"),
          background(c.paper),
        ]}
      >
        <Section title="当前服务" footer={<Text>{notice}</Text>}>
          <List.ForEach
            data={services}
            keyExtractor={(service) => service.id}
            recycling={false}
          >
            {({ item: service }) => (
              <SwipeActions modifiers={[listRowBackground(c.surface)]}>
                <HStack spacing={12} modifiers={[padding({ vertical: 8 })]}>
                  <Button
                    onPress={() => onSelect(service)}
                    modifiers={[
                      buttonStyle("plain"),
                      accessibilityLabel(
                        "使用 " +
                          service.name +
                          (service.id === selectedId ? "，已选择" : ""),
                      ),
                    ]}
                  >
                    <HStack
                      spacing={14}
                      modifiers={[
                        frame({
                          minHeight: 44,
                          maxWidth: Infinity,
                          alignment: "leading",
                        }),
                      ]}
                    >
                      <Image
                        systemName={
                          service.id === selectedId
                            ? "checkmark.circle.fill"
                            : "circle"
                        }
                        color={
                          service.id === selectedId ? c.accent : c.secondary
                        }
                        size={22}
                      />
                      <VStack alignment="leading" spacing={4}>
                        <Text
                          modifiers={[
                            font({ textStyle: "body" }),
                            foregroundStyle(c.ink),
                          ]}
                        >
                          {service.name}
                        </Text>
                        <Text
                          modifiers={[
                            font({ textStyle: "subheadline" }),
                            foregroundStyle(c.secondary),
                          ]}
                        >
                          {service.model}
                        </Text>
                      </VStack>
                    </HStack>
                  </Button>
                  <Button
                    label="编辑"
                    systemImage="pencil"
                    onPress={() => onEdit(service)}
                    modifiers={[
                      buttonStyle("plain"),
                      labelStyle("iconOnly"),
                      tint(c.secondary),
                      frame({ minWidth: 44, minHeight: 44 }),
                      accessibilityLabel("编辑 " + service.name),
                    ]}
                  />
                </HStack>
                <SwipeActions.Actions allowsFullSwipe={false}>
                  <Button
                    label="删除"
                    systemImage="trash"
                    onPress={() => onRemove(service)}
                    modifiers={[
                      tint("#A33232"),
                      accessibilityLabel("删除 " + service.name),
                    ]}
                  />
                </SwipeActions.Actions>
              </SwipeActions>
            )}
          </List.ForEach>
          <Button
            label="添加 AI 服务"
            systemImage="plus"
            onPress={onAdd}
            modifiers={[
              tint(c.accent),
              listRowBackground(c.surface),
              padding({ vertical: 10 }),
            ]}
          />
        </Section>
      </List>
    </Host>
  );
}
