import { Directory, File, FileMode } from "expo-file-system";
import { Gunzip } from "fflate";
import { nativeSemanticMarkerMatches, SEMANTIC_MODEL_FILES, SEMANTIC_MODEL_SHA256 } from "./semanticManifest";

type CancellationSignal = { readonly aborted: boolean };
function checkCancelled(signal?: CancellationSignal) {
  if (signal?.aborted) throw Object.assign(new Error("语义资料准备已取消。"), { name: "AbortError" });
}

/** Read-only native startup policy, including a complete receipt and all assets. */
export async function hasNativeSemanticAssets(directory: Directory): Promise<boolean> {
  const marker = new File(directory, ".installed.json");
  if (!marker.exists) return false;
  try {
    return nativeSemanticMarkerMatches(JSON.parse(await marker.text())) && SEMANTIC_MODEL_FILES.every(spec => {
      const file = new File(directory, spec.name);
      return file.exists && file.size === spec.bytes;
    });
  } catch { return false; }
}

/** Called under embedding's runtime queue. Never downloads, rewrites a receipt,
 * or deletes an existing model. The native compressed directory stays intact. */
export async function prepareNativeSemanticModel(directory: Directory, signal?: CancellationSignal): Promise<void> {
  checkCancelled(signal);
  const target = new File(directory, "model.onnx");
  if (!(await hasNativeSemanticAssets(directory))) {
    // Existing manually provisioned RN models remain the explicit development
    // path supported by embedding.native. An unmarked compressed dir is rejected.
    if (target.exists) return;
    throw new Error("离线语义资料安装标记不完整，请重新下载。");
  }
  for (const spec of SEMANTIC_MODEL_FILES) {
    checkCancelled(signal);
    if ((await new File(directory, spec.name).digest("SHA-256")).toLowerCase() !== spec.sha256)
      throw new Error("离线语义资料文件校验未通过，请重新下载。");
  }
  if (target.exists) {
    checkCancelled(signal);
    if ((await target.digest("SHA-256")).toLowerCase() !== SEMANTIC_MODEL_SHA256)
      throw new Error("离线语义资料解压文件校验未通过，请重新下载。");
    checkCancelled(signal);
    return;
  }
  const temporaryUri = new File(directory, ".model-preparing-" + Date.now() + "-" + Math.random().toString(36).slice(2)).uri;
  try {
    const temporary = new File(temporaryUri);
    temporary.create();
    const source = new File(directory, "model.onnx.gz").open(FileMode.ReadOnly);
    try {
      const output = temporary.open(FileMode.WriteOnly);
      try {
        const gunzip = new Gunzip(chunk => output.writeBytesSync(chunk));
        const total = source.size ?? 0;
        let consumed = 0;
        while (consumed < total) {
          checkCancelled(signal);
          const chunk = await source.readBytes(256 * 1024);
          if (!chunk.length) throw new Error("语义资料读取提前结束，请重新下载。");
          consumed += chunk.length;
          gunzip.push(chunk, consumed >= total);
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      } finally { output.close(); }
    } finally { source.close(); }
    checkCancelled(signal);
    if ((await temporary.digest("SHA-256")).toLowerCase() !== SEMANTIC_MODEL_SHA256)
      throw new Error("离线语义资料解压文件校验未通过，请重新下载。");
    checkCancelled(signal);
    // Both files share a directory; rename publishes only the complete verified file.
    // moveSync matches the short synchronous update section used by model removal.
    temporary.moveSync(target);
  } finally {
    const unfinished = new File(temporaryUri);
    if (unfinished.exists) unfinished.delete();
  }
}
