import assert from "node:assert/strict";
import test from "node:test";
import { hooks, loader } from "../ui/settings/__tests__/platformHarness.mts";

function harness(flushProgress: () => Promise<boolean>) {
  const host = hooks();
  const alerts: any[] = [],
    exits: string[] = [];
  const useReaderExit = loader({
    react: host.react,
    "react-native": { Alert: { alert: (...args: any[]) => alerts.push(args) } },
  })("apps/mobile/src/reader/useReaderExit.ts").useReaderExit;
  const render = (bookId = "book-a") =>
    host.render(() =>
      useReaderExit({
        bookId,
        flushProgress,
        onExit: () => exits.push(bookId),
      }),
    );
  return { render, alerts, exits, unmount: host.unmount };
}

test("a failed reader exit remains locked through confirmation and cancellation permits one retry", async () => {
  let calls = 0;
  const ui = harness(async () => ++calls > 1);
  const back = ui.render();
  await Promise.all([back(), back()]);
  assert.equal(calls, 1);
  assert.equal(ui.alerts.length, 1);
  const old = ui.alerts[0][2];
  old[0].onPress();
  await back();
  assert.deepEqual(ui.exits, ["book-a"]);
  old[1].onPress();
  await back();
  assert.deepEqual(ui.exits, ["book-a"]);
  ui.unmount();
});

test("confirming an unsaved reader exit leaves once and ignores delayed confirmation events", async () => {
  const ui = harness(async () => false);
  const back = ui.render();
  await back();
  const leave = ui.alerts[0][2][1].onPress;
  leave();
  leave();
  await back();
  assert.deepEqual(ui.exits, ["book-a"]);
  ui.unmount();
});

test("finishing a previous reader's flush cannot navigate a different or unmounted reader", async () => {
  for (const mode of ["switch", "unmount"]) {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const ui = harness(() => pending);
    const back = ui.render();
    const exiting = back();
    if (mode === "switch") ui.render("book-b");
    else ui.unmount();
    finish(true);
    await exiting;
    await back();
    assert.deepEqual(ui.exits, []);
    assert.deepEqual(ui.alerts, []);
    if (mode === "switch") ui.unmount();
  }
});

test("an unexpected flush rejection offers the existing unsaved-exit choice", async () => {
  const ui = harness(async () => {
    throw new Error("disk failure");
  });
  await ui.render()();
  assert.equal(ui.alerts[0][0], "位置与设置尚未保存");
  assert.deepEqual(ui.exits, []);
  ui.unmount();
});
