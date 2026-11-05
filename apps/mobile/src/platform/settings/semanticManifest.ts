/** The release assets shared with native SemanticModelStore. */
export const SEMANTIC_MODEL_FILES = [
  { name: "model.onnx.gz", bytes: 75546406, sha256: "e4ec66a19479ab9996124d52874e47c560b8bb6af2e07556b52e07d6419b0184" },
  { name: "tokenizer.json", bytes: 9081518, sha256: "2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8" },
  { name: "tokenizer_config.json", bytes: 581, sha256: "fdc4d08ae5071db078dee8eeb26a861f926cc27692637fa45ec7fd29753193e2" },
] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const SEMANTIC_MODEL_SHA256 = "783fea82d71a58179b830a4dbd2d58447e640609e98eedf9ffa12622d375a672";

/** Native stores the three compressed release assets; extraction is a runtime step. */
export function nativeSemanticMarkerMatches(value: unknown): boolean {
  if (!record(value) || value.version !== 1) return false;
  const { bytes, hashes } = value;
  return record(bytes) && record(hashes) && SEMANTIC_MODEL_FILES.every(spec =>
    bytes[spec.name] === spec.bytes && hashes[spec.name] === spec.sha256);
}

/** Accept only a complete native v1 or current RN v2 release receipt. Reading a
 * legacy receipt never rewrites it or blesses an unmarked directory. Actual
 * byte hashes are verified at installation; this is the native startup check. */
export function semanticMarkerMatches(value: unknown, modelBytes: number): boolean {
  if (!record(value) || !Number.isSafeInteger(modelBytes) || modelBytes <= 1_000_000) return false;
  if (value.version === 1) return nativeSemanticMarkerMatches(value);
  if (value.version !== 2 || value.modelBytes !== modelBytes || !Array.isArray(value.files) || value.files.length !== SEMANTIC_MODEL_FILES.length) return false;
  const files: unknown[] = value.files;
  return SEMANTIC_MODEL_FILES.every(spec => files.filter(file =>
    record(file) && file.name === spec.name && file.bytes === spec.bytes && file.sha256 === spec.sha256).length === 1);
}
