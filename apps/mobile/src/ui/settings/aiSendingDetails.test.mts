import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AI_SENDING_DETAILS } from "./aiSendingDetails.ts";

test("the sending details retain all four native sections verbatim", () => {
  const native = readFileSync(new URL("../../../../../ios/Shudeng/Sources/AIPrivacyController.swift", import.meta.url), "utf8");
  const section = native.split("if content == .sending {")[1]!.split("return [")[1]!.split("]")[0]!;
  const paragraphs = Array.from(section.matchAll(/\("([^"]+)", "([^"]+)"\)/g), match => ({ heading: match[1], body: match[2] }));
  assert.equal(paragraphs.length, 4);
  assert.deepEqual(AI_SENDING_DETAILS, paragraphs);
});

test("profile and book-chat push details inside their own stack and back returns to the caller", () => {
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const routeFile = fileURLToPath(new URL("./SettingsRoutes.tsx", import.meta.url));
  const code = ts.transpileModule(readFileSync(routeFile, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const pushes: unknown[] = [];
  let backs = 0;
  const compiled: any = new Module(routeFile);
  compiled.filename = routeFile;
  compiled.require = (id: string) => {
    if (id === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
    if (id === "expo-router") return { useRouter: () => ({ push: (path: unknown) => pushes.push(path), back: () => backs++ }) };
    if (id === "./AISettingsScreen") return { AISettingsScreen: "AISettingsScreen" };
    if (id === "./MCPSettingsScreen") return { MCPSettingsScreen: "MCPSettingsScreen" };
    if (id === "./AISendingDetailsScreen") return { AISendingDetailsScreen: "AISendingDetailsScreen" };
    if (id === "./AssistantSettingsScreen") return { AssistantSettingsScreen: "AssistantSettingsScreen" };
    throw new Error(id);
  };
  compiled._compile(code, routeFile);
  for (const scope of ["profile", "book-chat"]) compiled.exports.AISettingsRoute({ scope }).props.onSendingDetails();
  assert.deepEqual(pushes, ["/ai-sending-details", "/book-chat/ai-sending-details"]);
  const screen = compiled.exports.AISendingDetailsRoute();
  assert.equal(screen.type, "AISendingDetailsScreen");
  screen.props.onBack();
  assert.equal(backs, 1);
});
