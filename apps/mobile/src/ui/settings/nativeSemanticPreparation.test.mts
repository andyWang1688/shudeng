import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomFillSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, existsSync, statSync, readdirSync, readFileSync, writeFileSync, rmSync, renameSync, copyFileSync, openSync, closeSync, readSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loader, root } from "./__tests__/platformHarness.mts";

// Real gzip/SHA/file bytes; a tiny release manifest and Node FS implement the
// platform ports. This proves the production preparation/call chain, not ORT
// numeric inference or the Expo native bridge. No network or user files.
const require = createRequire(path.join(root, "apps/mobile/package.json"));
const { Gunzip } = require("fflate");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const temporary = mkdtempSync(path.join(tmpdir(), "shudeng-native-semantic-"));
  const document = path.join(temporary, "documents"); mkdirSync(document);
  const directory = path.join(document, "SemanticModel"); mkdirSync(directory);
  const model = randomFillSync(Buffer.alloc(1_100_000));
  const assets = new Map<string, Buffer>([["model.onnx.gz", gzipSync(model)], ["tokenizer.json", Buffer.from("{}")], ["tokenizer_config.json", Buffer.from("{}")]]);
  const specs = [...assets].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) }));
  const receipt = { version: 1, bytes: Object.fromEntries(specs.map(spec => [spec.name, spec.bytes])), hashes: Object.fromEntries(specs.map(spec => [spec.name, spec.sha256])) };
  assets.forEach((value, name) => writeFileSync(path.join(directory, name), value));
  const originalReceipt = JSON.stringify(receipt); writeFileSync(path.join(directory, ".installed.json"), originalReceipt);
  let reads = 0, handles = 0, moves = 0, sessions = 0, failMove = false;
  let onRead: (() => void) | undefined;
  const joined = (...parts: any[]) => path.join(...parts.map(part => typeof part === "string" ? part : part.uri));
  class Directory {
    uri: string; constructor(...parts: any[]) { this.uri = joined(...parts); }
    get exists() { return existsSync(this.uri); }
    create() { mkdirSync(this.uri, { recursive: true }); }
    list() { return readdirSync(this.uri).map(name => statSync(path.join(this.uri, name)).isDirectory() ? new Directory(this.uri, name) : new File(this.uri, name)); }
    delete() { rmSync(this.uri, { recursive: true }); }
    async move(target: Directory) { renameSync(this.uri, target.uri); this.uri = target.uri; }
  }
  class File {
    uri: string; constructor(...parts: any[]) { this.uri = joined(...parts); }
    get exists() { return existsSync(this.uri); }
    get size() { return this.exists ? statSync(this.uri).size : 0; }
    get name() { return path.basename(this.uri); }
    get parentDirectory() { return new Directory(path.dirname(this.uri)); }
    info() { return { size: this.size }; }
    async text() { return readFileSync(this.uri, "utf8"); }
    async digest(algorithm: string) { assert.equal(algorithm, "SHA-256"); return hash(readFileSync(this.uri)); }
    create() { writeFileSync(this.uri, Buffer.alloc(0), { flag: "wx" }); }
    write(value: string) { writeFileSync(this.uri, value); }
    delete() { rmSync(this.uri); }
    moveSync(target: File) { moves++; if (failMove) throw new Error("owned fixture rename failure"); renameSync(this.uri, target.uri); this.uri = target.uri; }
    async copy(target: File) { copyFileSync(this.uri, target.uri); }
    open(mode: string) {
      const fd = openSync(this.uri, mode); handles++; const size = this.size; let offset = 0;
      return { size, async readBytes(count: number) { const chunk = Buffer.alloc(Math.min(count, size - offset)); const length = readSync(fd, chunk, 0, chunk.length, offset); offset += length; reads++; onRead?.(); return chunk.subarray(0, length); }, writeBytesSync(bytes: Uint8Array) { writeSync(fd, bytes); }, close() { closeSync(fd); handles--; } };
    }
  }
  const manifest = {
    SEMANTIC_MODEL_FILES: specs, SEMANTIC_MODEL_SHA256: hash(model),
    nativeSemanticMarkerMatches(value: any) { return value?.version === 1 && specs.every(spec => value.bytes?.[spec.name] === spec.bytes && value.hashes?.[spec.name] === spec.sha256); },
  };
  const load = loader({
    "expo-file-system": { Directory, File, FileMode: { ReadOnly: "r", WriteOnly: "w" }, Paths: { document } },
    fflate: { Gunzip }, "./semanticManifest": manifest,
    "@huggingface/tokenizers": { Tokenizer: class { encode() { return { ids: [0, 1, 2] }; } token_to_id() { return 2; } } },
    "onnxruntime-react-native": {
      Tensor: class { constructor(..._args: any[]) {} },
      InferenceSession: { async create(modelPath: string) {
        sessions++; assert.deepEqual(readFileSync(modelPath), model, "ORT is loaded only after complete verified preparation");
        return { inputNames: ["input_ids", "attention_mask"], outputNames: ["last_hidden_state"], async run() { return { last_hidden_state: { dims: [1, 3, 384], data: new Float32Array(3 * 384).fill(1) } }; }, async release() {} };
      } },
    },
  });
  const preparation = load("apps/mobile/src/platform/settings/nativeSemanticModel.ts");
  const embedding = load("apps/mobile/src/platform/embedding.native.ts");
  return { document, directory, model, receipt, originalReceipt, specs, load, preparation, embedding, Directory, File,
    get handles() { return handles; }, get reads() { return reads; }, get moves() { return moves; }, get sessions() { return sessions; },
    abortOnRead(abort: AbortController) { onRead = () => abort.abort(); }, clearReadHook() { onRead = undefined; }, failMove() { failMove = true; },
    dispose() { rmSync(temporary, { recursive: true, force: true }); } };
}
test("compressed native install is read-only available, then first embedding prepares locally before model load", async () => {
  const f = fixture();
  try {
    const before = readdirSync(f.directory).sort();
    assert.equal((await f.embedding.embeddingStatus()).available, true);
    assert.deepEqual(readdirSync(f.directory).sort(), before); assert.equal(f.moves, 0);
    const vectors = await f.embedding.getEmbeddingProvider().embed(["local fixture"]);
    assert.equal(vectors[0].length, 384); assert.equal(f.sessions, 1); assert.equal(f.moves, 1); assert.ok(f.reads > 1); assert.equal(f.handles, 0);
    assert.deepEqual(readFileSync(path.join(f.directory, "model.onnx")), f.model);
    assert.equal(readFileSync(path.join(f.directory, ".installed.json"), "utf8"), f.originalReceipt);
    await f.embedding.getEmbeddingProvider().embed(["reuse"]); assert.equal(f.moves, 1); assert.equal(f.sessions, 1);
    assert.equal(readdirSync(f.directory).filter(name => name.startsWith(".model-preparing-")).length, 0);
  } finally { f.dispose(); }
});
test("cancelled native preparation removes only its temporary file and can retry without redownloading", async () => {
  const f = fixture(); const abort = new AbortController(); f.abortOnRead(abort);
  try {
    await assert.rejects(f.preparation.prepareNativeSemanticModel(new f.Directory(f.directory), abort.signal), { name: "AbortError" });
    assert.equal(f.handles, 0); assert.equal(f.moves, 0); assert.ok(!existsSync(path.join(f.directory, "model.onnx")));
    assert.equal(readdirSync(f.directory).filter(name => name.startsWith(".model-preparing-")).length, 0);
    assert.equal(readFileSync(path.join(f.directory, ".installed.json"), "utf8"), f.originalReceipt);
    f.clearReadHook(); await f.preparation.prepareNativeSemanticModel(new f.Directory(f.directory));
    assert.deepEqual(readFileSync(path.join(f.directory, "model.onnx")), f.model);
  } finally { f.dispose(); }
});
test("missing marker, invalid receipt and corrupted compressed bytes cannot publish a model", async () => {
  for (const defect of ["missing", "incomplete", "hash"] as const) {
    const f = fixture();
    try {
      if (defect === "missing") rmSync(path.join(f.directory, ".installed.json"));
      if (defect === "incomplete") writeFileSync(path.join(f.directory, ".installed.json"), JSON.stringify({ version: 1 }));
      if (defect === "hash") { const bytes = readFileSync(path.join(f.directory, "model.onnx.gz")); bytes[25] ^= 1; writeFileSync(path.join(f.directory, "model.onnx.gz"), bytes); }
      await assert.rejects(f.preparation.prepareNativeSemanticModel(new f.Directory(f.directory)), /标记|校验/);
      assert.equal(f.moves, 0); assert.equal(f.handles, 0); assert.ok(!existsSync(path.join(f.directory, "model.onnx")));
      assert.equal(readdirSync(f.directory).filter(name => name.startsWith(".model-preparing-")).length, 0);
    } finally { f.dispose(); }
  }
});
test("failed publication cleans verified temporary output without rewriting the native receipt", async () => {
  const f = fixture(); f.failMove();
  try {
    await assert.rejects(f.preparation.prepareNativeSemanticModel(new f.Directory(f.directory)), /rename failure/);
    assert.equal(f.handles, 0); assert.ok(!existsSync(path.join(f.directory, "model.onnx")));
    assert.equal(readdirSync(f.directory).filter(name => name.startsWith(".model-preparing-")).length, 0);
    assert.equal(readFileSync(path.join(f.directory, ".installed.json"), "utf8"), f.originalReceipt);
  } finally { f.dispose(); }
});
test("existing legacy copy entry accepts complete compressed native assets and first runtime use prepares its copy", async () => {
  const f = fixture();
  try {
    const legacy = path.join(f.document, "legacy"); mkdirSync(legacy);
    const source = path.join(legacy, "SemanticModel"); renameSync(f.directory, source);
    writeFileSync(path.join(legacy, "book-index.sqlite"), "fake-only-index");
    const driver = { async all() { return []; } };
    const legacyLoader = loader({
      "expo-file-system": { Directory: f.Directory, File: f.File, Paths: { document: f.document } },
      "expo-sqlite": { async openDatabaseAsync() { return {}; } },
      "@shudeng/core": { createLocalId: () => "owned-copy", LegacyIndexBookSource: class {}, LegacyIndexSearch: class {} },
      "@shudeng/core/db": { createExpoSQLiteDriver: () => driver },
      "../embedding": f.embedding, "../db": { async getDataLayer() { return { driver }; } },
      "../library/bookFileOperations": { legacyBookDataDeletedKey: (s: string) => "deleted:" + s, legacyBookIndexRetiredKey: (s: string) => "retired:" + s },
      "../settings/nativeSemanticModel": f.preparation,
    });
    const api = legacyLoader("apps/mobile/src/platform/ai/legacyIndex.ts");
    assert.equal((await api.getLegacyIndexRuntime()).semantic, true);
    assert.ok(existsSync(path.join(f.directory, "model.onnx.gz"))); assert.ok(!existsSync(path.join(f.directory, "model.onnx")));
    await f.embedding.getEmbeddingProvider().embed(["from copied native assets"]);
    assert.deepEqual(readFileSync(path.join(f.directory, "model.onnx")), f.model);
    assert.ok(!existsSync(path.join(source, "model.onnx")), "immutable legacy backup is never decompressed or rewritten");
    assert.equal(readFileSync(path.join(source, ".installed.json"), "utf8"), f.originalReceipt);
  } finally { f.dispose(); }
});
