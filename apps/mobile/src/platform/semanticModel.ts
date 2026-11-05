/** Bounded-memory download + hash verification + staging install of the official offline model. */
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { Gunzip } from "fflate";
import { resetEmbeddingRuntime } from "./embedding";
import { promoteModelDirectory } from "./settings/modelInstall";
import { SEMANTIC_MODEL_FILES as FILES, semanticMarkerMatches } from "./settings/semanticManifest";
import { hasNativeSemanticAssets } from "./settings/nativeSemanticModel";

const BASE =
  "https://github.com/andyWang1688/shudeng/releases/download/semantic-model-v2/";
const SOURCES = [
  "https://gh-proxy.com/",
  "https://ghfast.top/",
  "https://ghproxy.net/",
  "",
];
const TOTAL = FILES.reduce((total, file) => total + file.bytes, 0);
export interface SemanticModelState {
  readonly installed: boolean;
  readonly bytes: number;
}
export interface SemanticProgress {
  readonly stage: "download" | "verify" | "extract";
  readonly fraction: number;
  readonly source?: string;
}
function root(): Directory {
  return new Directory(Paths.document, "SemanticModel");
}
function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw Object.assign(new Error("下载已取消。"), { name: "AbortError" });
}
export async function getSemanticModelState(): Promise<SemanticModelState> {
  const directory = root();
  const model = new File(directory, "model.onnx");
  const tokenizer = new File(directory, "tokenizer.json");
  const config = new File(directory, "tokenizer_config.json");
  const unpacked =
    model.exists &&
    model.size > 1_000_000 &&
    tokenizer.exists &&
    tokenizer.size === FILES[1].bytes &&
    config.exists &&
    config.size === FILES[2].bytes;
  const marker = new File(directory, ".installed.json");
  let installed = await hasNativeSemanticAssets(directory);
  if (unpacked && marker.exists) {
    try {
      installed = semanticMarkerMatches(JSON.parse(await marker.text()), model.size) && FILES.every(spec => {
        const file = new File(directory, spec.name);
        return file.exists && file.size === spec.bytes;
      });
    } catch {
      installed = false;
    }
  }
  return { installed, bytes: directory.exists ? (directory.size ?? 0) : 0 };
}
let installing = false;
export async function installSemanticModel(
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (value: SemanticProgress) => void;
  } = {},
): Promise<void> {
  if (installing) throw new Error("已有资料下载正在进行。");
  if (Paths.availableDiskSpace < 600 * 1024 * 1024)
    throw new Error("存储空间不足，请至少保留 600 MB 后重试。");
  installing = true;
  const suffix = Date.now() + "-" + Math.random().toString(36).slice(2);
  // Expo move() mutates its source object's URI. Keep immutable paths for cleanup and rollback.
  const stagingUri = new Directory(
    Paths.document,
    ".semantic-staging-" + suffix,
  ).uri;
  const backupUri = new Directory(
    Paths.document,
    ".semantic-previous-" + suffix,
  ).uri;
  const installedUri = root().uri;
  const staging = new Directory(stagingUri);
  try {
    staging.create({ intermediates: true });
    let completed = 0;
    for (const spec of FILES) {
      checkCancelled(options.signal);
      let verified = false;
      let lastError: unknown;
      for (const prefix of SOURCES) {
        const target = new File(staging, spec.name);
        if (target.exists) target.delete();
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(
          () => controller.abort(),
          prefix ? 60_000 : 180_000,
        );
        try {
          checkCancelled(options.signal);
          await File.downloadFileAsync(prefix + BASE + spec.name, target, {
            signal: controller.signal,
            onProgress: (progress) =>
              options.onProgress?.({
                stage: "download",
                fraction:
                  (completed + Math.min(progress.bytesWritten, spec.bytes)) /
                  TOTAL,
                source: prefix ? new URL(prefix).host : "github.com",
              }),
          });
          options.onProgress?.({
            stage: "verify",
            fraction: completed / TOTAL,
          });
          if (
            target.size !== spec.bytes ||
            (await target.digest("SHA-256")).toLowerCase() !== spec.sha256
          )
            throw new Error("下载的资料不完整，文件校验未通过。");
          verified = true;
          break;
        } catch (error) {
          lastError = error;
          checkCancelled(options.signal);
          if (target.exists) target.delete();
        } finally {
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", abort);
        }
      }
      if (!verified)
        throw lastError instanceof Error
          ? lastError
          : new Error("下载失败，请检查网络后重试。");
      completed += spec.bytes;
    }
    const source = new File(staging, "model.onnx.gz");
    const target = new File(staging, "model.onnx");
    target.create();
    const reader = source.open(FileMode.ReadOnly);
    const writer = target.open(FileMode.WriteOnly);
    try {
      const gunzip = new Gunzip((chunk: Uint8Array) =>
        writer.writeBytesSync(chunk),
      );
      const total = reader.size ?? 0;
      let consumed = 0;
      while (consumed < total) {
        checkCancelled(options.signal);
        const chunk = await reader.readBytes(256 * 1024);
        if (!chunk.length)
          throw new Error("语义资料读取提前结束，请重新下载。");
        consumed += chunk.length;
        gunzip.push(chunk, consumed >= total);
        options.onProgress?.({ stage: "extract", fraction: consumed / total });
        // Yield between bounded chunks, so cancel and UI progress remain responsive.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      reader.close();
      writer.close();
    }
    checkCancelled(options.signal);
    const magic = target.open(FileMode.ReadOnly);
    try {
      if (target.size < 1_000_000 || (await magic.readBytes(1)).length !== 1)
        throw new Error("语义资料解压失败。");
    } finally {
      magic.close();
    }
    new File(staging, ".installed.json").write(
      JSON.stringify({ version: 2, files: FILES, modelBytes: target.size }),
    );
    // Keep the compressed verified asset for future integrity checks; replace the whole directory only after success.
    await resetEmbeddingRuntime(() => {
      checkCancelled(options.signal);
      promoteModelDirectory(
        { staging: stagingUri, installed: installedUri, backup: backupUri },
        {
          exists: (path) => new Directory(path).exists,
          move: (source, destination) =>
            new Directory(source).moveSync(new Directory(destination)),
          remove: (path) => new Directory(path).delete(),
        },
      );
    });
  } finally {
    installing = false;
    const unfinished = new Directory(stagingUri);
    if (unfinished.exists) unfinished.delete();
  }
}
export async function removeSemanticModel(): Promise<void> {
  if (installing) throw new Error("请先取消资料下载。");
  await resetEmbeddingRuntime(() => {
    const directory = root();
    if (directory.exists) directory.delete();
  });
}
