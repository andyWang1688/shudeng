/** 按 key 保持首次出现顺序分组（Notes/Conversations 共用）。 */
export function groupByKey<T, K extends string>(items: readonly T[], key: (item: T) => K): Array<{ key: K; items: T[] }> {
  const groups = new Map<K, { key: K; items: T[] }>();
  for (const item of items) {
    const itemKey = key(item);
    const group = groups.get(itemKey);
    if (group) group.items.push(item);
    else groups.set(itemKey, { key: itemKey, items: [item] });
  }
  return [...groups.values()];
}
