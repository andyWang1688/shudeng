/** 列表时间文案：与 Swift BookDateFormat 完全一致。 */
const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function padMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function recordTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (isSameDay(date, now)) return `今天 ${clockFormatter.format(date)}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `昨天 ${clockFormatter.format(date)}`;
  return padMonthDay(date);
}
