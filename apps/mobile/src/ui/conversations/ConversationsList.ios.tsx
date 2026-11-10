import type { ReactNode } from "react";
import {
  Button, DisclosureGroup, Group, Host, HStack, Image, List,
  Rectangle, RoundedRectangle, Spacer, SwipeActions, Text, VStack, ZStack,
} from "@expo/ui/swift-ui";
import {
  Animation, accessibilityHidden, accessibilityLabel, animation, aspectRatio,
  background, buttonStyle, clipShape, disabled, font, foregroundStyle, frame,
  lineLimit, listRowBackground, listRowInsets, listRowSeparator,
  listRowSeparatorTint, listStyle, padding, resizable, scrollContentBackground,
  scrollDismissesKeyboard, tint,
} from "@expo/ui/swift-ui/modifiers";
import { useAppearance } from "../appearance";
import { bookSwatchTone, usePalette } from "../theme";
import { conversationTitle, type ConversationItem, type ConversationSection } from "./model";

export type ConversationsListProps = {
  readonly sections: readonly ConversationSection[];
  readonly searching: boolean;
  readonly previewLimit: number;
  readonly allBooks: ReadonlySet<string>;
  readonly active: boolean;
  readonly reduceMotion: boolean;
  readonly onExpandedChange: (bookId: string, expanded: boolean) => void;
  readonly onToggleAll: (bookId: string) => void;
  readonly onOpen: (item: ConversationItem) => void;
  readonly onRename: (item: ConversationItem) => void;
  readonly onDelete: (item: ConversationItem) => void;
};

/** SwiftUI owns list scrolling, disclosure, hit testing and swipe presentation. */
export function ConversationsList({ sections, searching, previewLimit, allBooks, active, reduceMotion, onExpandedChange, onToggleAll, onOpen, onRename, onDelete }: ConversationsListProps) {
  const p = usePalette();
  const { resolvedMode } = useAppearance();
  const transition = Animation.easeInOut({ duration: reduceMotion ? 0 : 0.22 });
  return (
    <Host style={{ flex: 1 }} colorScheme={resolvedMode} seedColor={p.lampInk} ignoreSafeArea="container" pointerEvents={active ? "auto" : "none"}>
      <List modifiers={[listStyle("plain"), scrollContentBackground("hidden"), background(p.paper), scrollDismissesKeyboard("interactively"), disabled(!active)]}>
        <List.ForEach data={[...sections]} keyExtractor={(section) => section.bookId} recycling={false}>
          {({ item: section }) => {
            const all = searching || allBooks.has(section.bookId);
            const rows = all ? section.data : section.data.slice(0, previewLimit);
            const rowModifiers = [listRowBackground(p.paper), listRowInsets({ leading: searching ? 64 : 44, trailing: 24, top: 0, bottom: 0 }), listRowSeparatorTint(p.line)];
            return (
              <BookGroup section={section} searching={searching} active={active} onExpandedChange={(expanded) => onExpandedChange(section.bookId, expanded)}
                transition={transition} visibleCount={rows.length}>
                <List.ForEach data={rows} keyExtractor={(item) => item.conversationId} recycling={false}>
                  {({ item }) => (
                    <SwipeActions modifiers={rowModifiers}>
                      <Button onPress={() => onOpen(item)} modifiers={[buttonStyle("plain"), accessibilityLabel("打开对话：" + conversationTitle(item)), disabled(!active)]}>
                        <HStack spacing={12} modifiers={[padding({ vertical: 16 }), frame({ minHeight: 62 })]}>
                          <Text modifiers={[font({ textStyle: "body" }), foregroundStyle(p.ink), lineLimit(2), frame({ maxWidth: Infinity, alignment: "leading" })]}>{conversationTitle(item)}</Text>
                          <Image systemName="chevron.right" size={12} color={p.ink3} modifiers={[accessibilityHidden()]} />
                        </HStack>
                      </Button>
                      <SwipeActions.Actions allowsFullSwipe={false}>
                        <Button label="删除" systemImage="trash" onPress={() => onDelete(item)} modifiers={[tint(p.error), disabled(!active), accessibilityLabel("删除：" + conversationTitle(item))]} />
                        <Button label="重命名" systemImage="pencil" onPress={() => onRename(item)} modifiers={[tint(p.ink2), disabled(!active), accessibilityLabel("重新命名：" + conversationTitle(item))]} />
                      </SwipeActions.Actions>
                    </SwipeActions>
                  )}
                </List.ForEach>
                {!searching && section.count > previewLimit && (
                  <Button label={all ? "收起" : "查看全部 " + section.count + " 条对话"} systemImage={all ? "chevron.up" : "chevron.down"}
                    onPress={() => onToggleAll(section.bookId)} modifiers={[...rowModifiers, foregroundStyle(p.lampInk), font({ textStyle: "subheadline" }), padding({ vertical: 12 }), disabled(!active),
                      accessibilityLabel(all ? "收起" + section.title + "的对话列表" : "查看" + section.title + "的全部" + section.count + "条对话")]} />
                )}
              </BookGroup>
            );
          }}
        </List.ForEach>
      </List>
    </Host>
  );
}

function BookGroup({ section, searching, active, onExpandedChange, children, transition, visibleCount }: {
  readonly section: ConversationSection;
  readonly searching: boolean;
  readonly active: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly children: ReactNode;
  readonly transition: ReturnType<typeof Animation.easeInOut>;
  readonly visibleCount: number;
}) {
  const p = usePalette();
  const tone = bookSwatchTone(section.title, section.book?.format);
  const modifiers = [tint(p.ink2), listRowBackground(p.paper), listRowSeparator("hidden"), listRowInsets({ leading: 24, trailing: 24, top: 14, bottom: 14 }),
    animation(transition, !section.collapsed), animation(transition, visibleCount)];
  const label = (
    <HStack spacing={12}>
      <ZStack modifiers={[frame({ width: 28, height: 38 }), accessibilityHidden()]}>
        <RoundedRectangle cornerRadius={2} modifiers={[foregroundStyle(tone.background)]} />
        <Rectangle modifiers={[frame({ width: 18, height: 1 }), foregroundStyle(tone.ink)]} />
        {section.book?.coverUri ? <Image uiImage={section.book.coverUri} modifiers={[resizable(), aspectRatio({ contentMode: "fill" }), frame({ width: 28, height: 38 }), clipShape("roundedRectangle", 2)]} /> : null}
      </ZStack>
      <VStack alignment="leading" spacing={5}>
        <Text modifiers={[font({ size: 23, weight: "bold", textStyle: "title2" }), foregroundStyle(p.ink)]}>{section.title}</Text>
        <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(p.ink3)]}>{section.count} 条对话</Text>
      </VStack>
      <Spacer minLength={0} />
    </HStack>
  );
  if (searching) return <Group><VStack modifiers={modifiers}>{label}</VStack>{children}</Group>;
  return (
    <DisclosureGroup isExpanded={!section.collapsed} onIsExpandedChange={onExpandedChange} modifiers={[...modifiers, disabled(!active)]}>
      <DisclosureGroup.Label>{label}</DisclosureGroup.Label>
      {children}
    </DisclosureGroup>
  );
}
