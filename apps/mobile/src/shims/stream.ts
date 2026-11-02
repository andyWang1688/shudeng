/** 打包/演示用的最小 stream shim（脚本 Agent 不依赖真实 Node 流）。 */
type Chunk = unknown;
export class Stream {
  pipe<T>(destination: T): T {
    return destination;
  }
  on(_event: string, _handler: (...args: unknown[]) => void): this {
    return this;
  }
  destroy(): void {}
  pause(): this {
    return this;
  }
  resume(): this {
    return this;
  }
}
export class Readable extends Stream {
  static from(iterable: Iterable<Chunk>): Readable {
    const stream = new Readable();
    stream._source = iterable;
    return stream;
  }
  private _source: Iterable<Chunk> = [];
  [Symbol.asyncIterator](): AsyncIterator<Chunk> {
    const iterator = this._source[Symbol.iterator]();
    return {
      next: async () => iterator.next(),
    };
  }
}
export class Writable extends Stream {}
export class Duplex extends Stream {}
export class Transform extends Stream {}
export class PassThrough extends Transform {}
export function pipeline(...args: unknown[]): unknown {
  return args[args.length - 1];
}
export function finished(stream: unknown, callback: () => void): void {
  callback();
  void stream;
}
export default { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished };
