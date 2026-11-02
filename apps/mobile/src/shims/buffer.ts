/** 最小 Buffer shim；脚本 Agent/JSON 路径不依赖二进制操作。 */
export class Buffer {
  private readonly bytes: Uint8Array;
  constructor(source: number | ArrayLike<number> | ArrayBuffer | Uint8Array) {
    if (typeof source === 'number') this.bytes = new Uint8Array(source);
    else if (source instanceof Uint8Array) this.bytes = source;
    else if (source instanceof ArrayBuffer) this.bytes = new Uint8Array(source);
    else this.bytes = Uint8Array.from(source);
  }
  static from(value: string | ArrayLike<number> | ArrayBuffer | Uint8Array, _encoding: string = 'utf8'): Buffer {
    if (typeof value === 'string') return new Buffer(new TextEncoder().encode(value));
    return new Buffer(value);
  }
  static alloc(size: number): Buffer {
    return new Buffer(size);
  }
  static isBuffer(value: unknown): boolean {
    return value instanceof Buffer;
  }
  static byteLength(value: string | ArrayBuffer): number {
    return typeof value === 'string' ? new TextEncoder().encode(value).length : value.byteLength;
  }
  static concat(list: readonly (Buffer | Uint8Array)[]): Buffer {
    const chunks = list.map((item) => (item instanceof Buffer ? item.bytes : item));
    const length = chunks.reduce((sum, item) => sum + item.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const item of chunks) {
      result.set(item, offset);
      offset += item.length;
    }
    return new Buffer(result);
  }
  get length(): number {
    return this.bytes.length;
  }
  get byteLength(): number {
    return this.bytes.byteLength;
  }
  toString(_encoding?: string): string {
    return new TextDecoder().decode(this.bytes);
  }
  [Symbol.iterator](): Iterator<number> {
    return this.bytes[Symbol.iterator]();
  }
}
export default Buffer;
