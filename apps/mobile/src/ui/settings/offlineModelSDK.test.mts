import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { root, loader } from "./__tests__/platformHarness.mts";

// Executes the installed Expo SDK's real File.downloadFileAsync JS wrapper and
// the real installer. Native filesystem/network/hash/decompression ports are
// modeled in memory; this does not claim an actual model download or inference.
const nativeSource = readFileSync(path.join(root, "ios/Shudeng/Sources/SemanticModelStore.swift"), "utf8");
const release = [...nativeSource.matchAll(/FileSpec\(\s*name: "([^"]+)",\s*bytes: ([\d_]+),\s*sha256: "([a-f0-9]+)"/g)]
  .map(match => ({ name: match[1], bytes: Number(match[2].replaceAll("_", "")), sha256: match[3] }));

function fixture(wrongHash = false) {
  type Entry = { bytes: number; hash?: string; text?: string };
  const files = new Map<string, Entry>(); const dirs = new Set<string>();
  const requests: string[] = [], digests: string[] = [], modes: string[] = [];
  const listeners = new Set<(v: any) => void>(); let sequence = 0, cancels = 0, resets = 0, opened = 0;
  const join = (...parts: any[]) => parts.map(p => typeof p === "string" ? p : p.uri).join("/");
  class Directory {
    uri: string; constructor(...parts: any[]) { this.uri = join(...parts); }
    get exists() { return dirs.has(this.uri); }
    get size() { return [...files].filter(([key]) => key.startsWith(this.uri + "/")).reduce((v, [, file]) => v + file.bytes, 0); }
    create() { dirs.add(this.uri); }
    delete() { for (const key of files.keys()) if (key.startsWith(this.uri + "/")) files.delete(key); for (const key of dirs) if (key === this.uri || key.startsWith(this.uri + "/")) dirs.delete(key); }
    move() { throw new Error("Expo move is async; the installer must use moveSync for its synchronous publication port"); }
    moveSync(destination: Directory) {
      const source = this.uri;
      for (const [key, value] of [...files]) if (key.startsWith(source + "/")) { files.delete(key); files.set(destination.uri + key.slice(source.length), value); }
      for (const key of [...dirs]) if (key === source || key.startsWith(source + "/")) { dirs.delete(key); dirs.add(destination.uri + key.slice(source.length)); }
      this.uri = destination.uri; // Matches Expo's mutating source URI.
    }
  }
  class NativeFile {
    uri: string; constructor(uri: string) { this.uri = uri; }
    validatePath() {}
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.bytes ?? 0; }
    create() { files.set(this.uri, { bytes: 0 }); }
    delete() { files.delete(this.uri); }
    write(text: string) { files.set(this.uri, { bytes: text.length, text }); }
    async text() { return files.get(this.uri)?.text ?? ""; }
    async digest(algorithm: string) { digests.push(algorithm); return files.get(this.uri)?.hash ?? ""; }
    open(mode: string) {
      modes.push(mode); opened++; let offset = 0, closed = false; const file = this;
      return {
        get size() { return file.size; },
        async readBytes(count: number) { const length = Math.min(count, file.size - offset); offset += length; return new Uint8Array(length); },
        writeBytesSync(chunk: Uint8Array) { files.get(file.uri)!.bytes += chunk.length; },
        close() { assert.equal(closed, false); closed = true; opened--; },
      };
    }
  }
  const native = {
    FileSystemFile: NativeFile,
    addListener(_name: string, listener: (v: any) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; },
    async cancelDownloadAsync(_id: string) { cancels++; },
    async downloadFileAsync(url: string, target: NativeFile, _options: any, uuid: string) {
      requests.push(url); const spec = release.find(row => url.endsWith(row.name))!;
      files.set(target.uri, { bytes: spec.bytes, hash: wrongHash ? "wrong" : spec.sha256 });
      listeners.forEach(listener => listener({ uuid, data: { bytesWritten: 1, totalBytes: spec.bytes } }));
      return target.uri;
    },
  };
  const paths = { document: "memory://documents", availableDiskSpace: 1024 ** 3, join };
  const load = loader({
    "expo-modules-core": { UnavailabilityError: Error, uuid: { v4: () => "sdk-" + ++sequence } },
    "react-native": { Platform: { OS: "ios" } }, "./Directory": { Directory }, "./ExpoFileSystem": { __esModule: true, default: native },
    "./File.types": { FileMode: { ReadOnly: "r", WriteOnly: "w" } }, "./NetworkTasks": { DownloadTask: class {}, UploadTask: class {} },
    "./Paths": { Paths: paths }, "./internal/FileSystemWatcher": { FileSystemWatcher: class {} },
    "./internal/streams": { FileSystemReadableStreamSource: class {}, FileSystemWritableSink: class {} },
    "./embedding": { async resetEmbeddingRuntime(work: () => void) { resets++; return work(); } },
    fflate: { Gunzip: class { onData: (data: Uint8Array) => void; constructor(onData: (data: Uint8Array) => void) { this.onData = onData; } push(chunk: Uint8Array) { this.onData(chunk); } } },
  });
  const SDKFile = load("apps/mobile/node_modules/expo-file-system/src/File.ts").File;
  const SDK = { Directory, File: SDKFile, FileMode: { ReadOnly: "r", WriteOnly: "w" }, Paths: paths };
  // Reuse the exact SDK class while the installer receives only its public API.
  const api = loader({ "expo-file-system": SDK,
    "./embedding": { async resetEmbeddingRuntime(work: () => void) { resets++; return work(); } },
    fflate: { Gunzip: class { onData: (data: Uint8Array) => void; constructor(onData: (data: Uint8Array) => void) { this.onData = onData; } push(chunk: Uint8Array) { this.onData(chunk); } } },
  })("apps/mobile/src/platform/semanticModel.ts");
  const installed = "memory://documents/SemanticModel";
  dirs.add(installed); files.set(installed + "/owned-old-sentinel", { bytes: 4, text: "keep" });
  return { api, files, dirs, installed, requests, digests, modes, get cancels() { return cancels; }, get listeners() { return listeners.size; }, get resets() { return resets; }, get opened() { return opened; } };
}
test("real Expo download wrapper feeds the verified installer, preserves v2 manifest, and cleans handles/staging", async () => {
  const f = fixture(); const progress: any[] = [];
  await f.api.installSemanticModel({ onProgress: (value: any) => progress.push(value) });
  assert.equal(f.requests.length, 3); assert.deepEqual(f.digests, ["SHA-256", "SHA-256", "SHA-256"]);
  assert.equal((await f.api.getSemanticModelState()).installed, true);
  const marker = JSON.parse(f.files.get(f.installed + "/.installed.json")!.text!);
  assert.equal(marker.version, 2); assert.deepEqual(marker.files, release); assert.ok(marker.modelBytes > 1000000);
  assert.equal(f.files.has(f.installed + "/owned-old-sentinel"), false);
  assert.equal(f.resets, 1); assert.equal(f.listeners, 0); assert.equal(f.opened, 0);
  assert.ok(progress.some(row => row.stage === "download" && row.fraction > 0)); assert.ok(progress.some(row => row.stage === "extract"));
  assert.deepEqual([...f.dirs], [f.installed]);
  assert.ok(f.modes.every(mode => ["r", "w"].includes(mode)));
});
test("real Expo signal forwarding cancels without promoting a partial model or leaking progress listeners", async () => {
  const f = fixture(); const abort = new AbortController();
  await assert.rejects(f.api.installSemanticModel({ signal: abort.signal, onProgress: () => abort.abort() }), { name: "AbortError" });
  assert.equal(f.cancels, 1); assert.equal(f.resets, 0); assert.equal(f.listeners, 0); assert.equal(f.opened, 0);
  assert.equal(f.files.get(f.installed + "/owned-old-sentinel")?.text, "keep"); assert.deepEqual([...f.dirs], [f.installed]);
});
test("release digest failure exhausts sources but never replaces the prior model", async () => {
  const f = fixture(true);
  await assert.rejects(f.api.installSemanticModel(), /校验未通过/);
  assert.equal(f.requests.length, 4); assert.equal(f.resets, 0); assert.equal(f.listeners, 0); assert.equal(f.opened, 0);
  assert.equal(f.files.get(f.installed + "/owned-old-sentinel")?.text, "keep"); assert.deepEqual([...f.dirs], [f.installed]);
});
