import { Alert, Linking, Pressable, Text, View } from "react-native";
import { ExternalLinkIcon } from "lucide-react-native";
import { Icon } from "@/components/ui/icon";
import type { Palette } from "../theme";
import type { ChatTurn } from "./types";

const searchLabels = {
  disabled: "未启用联网搜索",
  unsupported: "当前模型不支持内置联网搜索",
  enabled: "联网搜索已启用",
  searching: "正在搜索网页…",
  complete: "已完成联网搜索",
  failed: "联网搜索未完成",
} as const;

/** Native Elements has no sources component; book-specific links use its tokens. */
export function AssistantWebSources({
  turn,
}: {
  readonly turn: ChatTurn;
  readonly palette?: Palette;
}) {
  const sources = turn.webSources ?? [];
  const status = turn.webSearchStatus;
  if (
    !sources.length &&
    (!status || status.status === "disabled" || status.status === "enabled")
  )
    return null;
  return (
    <View testID={`question-web-sources-${turn.id}`} className="mt-2 gap-1">
      {sources.length ? (
        <Text className="text-muted-foreground mb-1 text-xs font-medium">
          网页来源
        </Text>
      ) : null}
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-muted-foreground text-xs leading-5"
        >
          {status.message || searchLabels[status.status]}
        </Text>
      ) : null}
      {sources.map((source) => {
        let target: URL | undefined;
        try {
          const url = new URL(source.url);
          if (url.protocol === "https:" || url.protocol === "http:")
            target = url;
        } catch {
          /* Invalid saved URLs remain inspectable. */
        }
        return (
          <Pressable
            key={source.id}
            accessibilityRole="link"
            accessibilityLabel={`打开网页来源：${source.title || source.url}`}
            onPress={() => {
              if (!target) {
                Alert.alert("无法打开来源", "这条来源没有有效的网页链接。");
                return;
              }
              void Linking.openURL(target.toString()).catch(() =>
                Alert.alert("无法打开来源", "请检查网络后重试。"),
              );
            }}
            className="active:bg-muted min-h-11 flex-row items-center gap-2 rounded-lg py-2"
          >
            <Icon
              as={ExternalLinkIcon}
              className="text-muted-foreground size-3.5"
            />
            <View className="flex-1">
              <Text
                numberOfLines={2}
                className="text-foreground text-[13px] leading-5"
              >
                {source.title || source.url}
              </Text>
              <Text numberOfLines={1} className="text-muted-foreground text-xs">
                {target?.hostname.replace(/^www\./, "") ?? "链接不可用"}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
