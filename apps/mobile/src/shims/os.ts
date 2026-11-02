export const EOL = '\n';
export function cpus(): unknown[] {
  return [];
}
export function totalmem(): number {
  return 0;
}
export function freemem(): number {
  return 0;
}
export function platform(): string {
  return 'react-native';
}
export function homedir(): string {
  return '';
}
export function tmpdir(): string {
  return '/tmp';
}
export default { EOL, cpus, totalmem, freemem, platform, homedir, tmpdir };
