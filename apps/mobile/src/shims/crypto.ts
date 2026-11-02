/** 最小 crypto shim：生成 id/摘要（非密码学用途；真实 provider 不在此 spike 使用）。 */
function randomHex(length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) value += Math.floor(Math.random() * 16).toString(16);
  return value;
}
export function randomUUID(): string {
  return `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
}
export function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}
export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return array;
}
export class Hash {
  private value = '';
  update(data: unknown): this {
    this.value += String(data);
    return this;
  }
  digest(_encoding?: string): string {
    let hash = 5381;
    for (let index = 0; index < this.value.length; index += 1) {
      hash = ((hash << 5) + hash + this.value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}
export function createHash(_algorithm: string): Hash {
  return new Hash();
}
export const webcrypto = globalThis.crypto;
export default { randomUUID, randomBytes, getRandomValues, createHash, webcrypto };
