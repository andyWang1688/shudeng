import test from "node:test";
import assert from "node:assert/strict";
import { nativeListNavigationOptions } from "./nativeListNavigationOptions.ts";

const palette = { lamp: "lamp", ink: "ink", paper: "paper" };

test("native list navigation preserves title geometry, scroll-edge transparency and palette colors", () => {
  for (const colors of [
    palette,
    { lamp: "dark-lamp", ink: "dark-ink", paper: "dark-paper" },
  ]) {
    const options = nativeListNavigationOptions(colors);
    assert.equal(options.headerShown, true);
    assert.equal(options.headerLargeTitleEnabled, true);
    assert.equal(options.headerLargeTitleShadowVisible, false);
    assert.equal(options.headerShadowVisible, false);
    assert.deepEqual(options.headerLargeStyle, {
      backgroundColor: "transparent",
    });
    assert.deepEqual(options.headerStyle, { backgroundColor: colors.paper });
    assert.deepEqual(options.contentStyle, { backgroundColor: colors.paper });
    assert.deepEqual(options.headerLargeTitleStyle, {
      fontFamily: "SongtiSC-Bold",
      fontSize: 30,
      fontWeight: "600",
      color: colors.ink,
    });
    assert.deepEqual(options.headerTitleStyle, {
      fontFamily: "SongtiSC-Bold",
      fontSize: 17,
      fontWeight: "600",
      color: colors.ink,
    });
    assert.equal(options.headerTintColor, colors.lamp);
    assert.equal("title" in options, false);
  }
});
