import assert from "node:assert/strict";
import test from "node:test";
import { hooks, jsx, loader, nativePorts, nodes, parts, flush } from "./platformHarness.mts";

test("an accepted editor completion cannot refresh an unmounted MCP settings owner", async () => {
  const h = hooks();
  let reads = 0;
  const Screen = loader({
    react: h.react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": nativePorts([]),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../theme": { usePalette: () => ({}) },
    "./SettingsParts": parts,
    "./MCPServerEditor": { MCPServerEditor: "MCPServerEditor" },
    "../../platform/mcp": {
      loadMCPServers: async () => { reads++; return []; },
      newMCPServer: () => ({ id: "new" }),
    },
  })("apps/mobile/src/ui/settings/MCPSettingsScreen.tsx").MCPSettingsScreen;
  const render = () => h.render(() => Screen({ onBack() {} }));
  render();
  await flush();
  nodes(render(), n => n.type === "SettingsAction" && n.props.title === "添加")[0].props.onPress();
  const editor = render();
  assert.equal(editor.type, "MCPServerEditor");
  h.unmount();
  editor.props.onChanged();
  await flush();
  assert.equal(reads, 1);
});
