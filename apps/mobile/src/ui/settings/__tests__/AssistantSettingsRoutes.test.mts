import test from "node:test";
import assert from "node:assert/strict";
import { jsx, loader } from "./platformHarness.mts";

test("profile and book-chat settings open assistant preferences within their own navigation stack", () => {
  const pushed: unknown[] = [];
  let backs = 0;
  let serverId: string | undefined;
  const { AISettingsRoute, AssistantSettingsRoute, MCPSettingsRoute } = loader({
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "expo-router": {
      useRouter: () => ({
        push: (value: unknown) => pushed.push(value),
        back: () => {
          backs++;
        },
      }),
      useLocalSearchParams: () => ({ serverId }),
    },
    "./AISettingsScreen": { AISettingsScreen: "AISettingsScreen" },
    "./MCPSettingsScreen": { MCPSettingsScreen: "MCPSettingsScreen" },
    "./AISendingDetailsScreen": {
      AISendingDetailsScreen: "AISendingDetailsScreen",
    },
    "./AssistantSettingsScreen": {
      AssistantSettingsScreen: "AssistantSettingsScreen",
    },
  })("apps/mobile/src/ui/settings/SettingsRoutes.tsx");
  AISettingsRoute({ scope: "profile" }).props.onAssistantSettings();
  AISettingsRoute({ scope: "book-chat" }).props.onAssistantSettings();
  assert.deepEqual(pushed, [
    "/assistant-settings",
    "/book-chat/assistant-settings",
  ]);
  const page = AssistantSettingsRoute();
  assert.equal(page.type, "AssistantSettingsScreen");
  page.props.onBack();
  assert.equal(backs, 1);
  pushed.length = 0;
  AISettingsRoute({ scope: "profile" }).props.onMCPSettings();
  AISettingsRoute({ scope: "book-chat" }).props.onMCPSettings();
  assert.deepEqual(pushed, ["/settings/mcp", "/book-chat/mcp"]);
  serverId = "existing-server";
  const mcp = MCPSettingsRoute();
  assert.equal(mcp.type, "MCPSettingsScreen");
  assert.equal(mcp.props.serverId, serverId);
  mcp.props.onBack();
  assert.equal(backs, 2);
});
