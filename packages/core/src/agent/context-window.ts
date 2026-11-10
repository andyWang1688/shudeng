/** Decimal K/M shorthand. Empty input selects automatic model metadata. */
export function parseContextWindowTokens(input: string): number | undefined {
  const text = input.trim();
  if (!text) return undefined;
  const match = /^(\d+)(?:\.(\d+))?\s*([km])?$/i.exec(text);
  if (!match) throw new Error('请输入精确整数或 K/M，例如 128K、1.05M。');
  const places = match[3]?.toLowerCase() === 'm' ? 6 : match[3] ? 3 : 0;
  const fraction = match[2] ?? '';
  // Shift decimal digits as text: 1.001M must not become 1000999.9999999999.
  const digits = match[1]! + fraction.slice(0, places).padEnd(places, '0');
  if (/[^0]/.test(fraction.slice(places)))
    throw new Error('Token 数量必须是整数。');
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 1_000)
    throw new Error('上下文窗口需为至少 1,000 的安全整数。');
  return value;
}
