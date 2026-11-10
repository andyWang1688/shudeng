/** Demo input only; never treats a user-entered limit as a verified capability. */
export function parseDemoContextWindow(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([KM])?$/i.exec(value.trim());
  if (!match) return undefined;
  const multiplier =
    match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2] ? 1_000 : 1;
  const tokens = Number(match[1]) * multiplier;
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : undefined;
}
