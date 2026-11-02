/** 打包/演示用 fs stub：脚本 Agent 不读写文件。 */
export function readFileSync(): never {
  throw new Error('fs is not available in React Native');
}
export function writeFileSync(): never {
  throw new Error('fs is not available in React Native');
}
export function existsSync(): boolean {
  return false;
}
export function promises(): never {
  throw new Error('fs.promises is not available in React Native');
}
export default { readFileSync, writeFileSync, existsSync, promises };
