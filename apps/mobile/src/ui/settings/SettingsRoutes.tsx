import { useLocalSearchParams, useRouter } from "expo-router";
import { AISettingsScreen } from "./AISettingsScreen";
import { MCPSettingsScreen } from "./MCPSettingsScreen";
import { AISendingDetailsScreen } from "./AISendingDetailsScreen";

type SettingsScope = "profile" | "book-chat";
const DESTINATIONS = {
  profile: { ai: "/ai-settings", mcp: "/settings/mcp", sending: "/ai-sending-details" },
  "book-chat": { ai: "/book-chat/ai-settings", mcp: "/book-chat/mcp", sending: "/book-chat/ai-sending-details" },
} as const;

/** Each caller owns a navigation stack while sharing all settings content. */
export function AISettingsRoute({ scope }: { readonly scope: SettingsScope }) {
  const router = useRouter();
  const destination = DESTINATIONS[scope];
  return (
    <AISettingsScreen
      onBack={() => router.back()}
      onSendingDetails={() => router.push(destination.sending)}
      onEditService={(serviceId) =>
        router.push({
          pathname: "/settings/ai-service",
          params: { serviceId, returnTo: destination.ai },
        })
      }
      onEditMCP={(serverId) =>
        router.push({
          pathname: destination.mcp,
          ...(serverId ? { params: { serverId } } : {}),
        })
      }
    />
  );
}

export function AISendingDetailsRoute() {
  const router = useRouter();
  return <AISendingDetailsScreen onBack={() => router.back()} />;
}

export function MCPSettingsRoute() {
  const router = useRouter();
  const { serverId } = useLocalSearchParams<{ serverId?: string }>();
  return <MCPSettingsScreen serverId={serverId} onBack={() => router.back()} />;
}
