import type { OrbitItem } from "../types";

function compareCatalogItems(left: OrbitItem, right: OrbitItem) {
  const leftOrder = left.sortOrder ?? 0;
  const rightOrder = right.sortOrder ?? 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.title.localeCompare(right.title, "zh-Hans-CN");
}

export function upsertItemById(items: OrbitItem[], item: OrbitItem): OrbitItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  const next = index < 0
    ? [...items, item]
    : items.map((candidate) => candidate.id === item.id ? item : candidate);
  return next.sort(compareCatalogItems);
}

export function upsertItemsById(items: OrbitItem[], incoming: OrbitItem[]): OrbitItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values()).sort(compareCatalogItems);
}

export function removeItemById(items: OrbitItem[], id: string): OrbitItem[] {
  return items.filter((item) => item.id !== id);
}
