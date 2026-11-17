import type { CallItem } from "@/lib/dashboard/needsYourCall";
import { RAIL_GROUPS, resolveNavTab, type RailGroupId } from "./navModel";

/** What needs a call on one navigation tab: how many items, and the first one's headline. */
export interface Attention {
  count: number;
  headline: string;
}

export type AttentionMap = Record<string, Attention>;

/**
 * Items that need a decision (hard or soft; notices never do), counted per navigation tab.
 * The backend's tab names are resolved to navigation ids, so `YouthAcademy` lands on `Youth`.
 */
export function buildAttentionMap(items: readonly CallItem[]): AttentionMap {
  const map: AttentionMap = {};
  for (const item of items) {
    if (item.severity === "info") continue;
    const tab = resolveNavTab(item.target.tab);
    const entry = map[tab];
    if (entry) entry.count += 1;
    else map[tab] = { count: 1, headline: item.headline };
  }
  return map;
}

/** The roll-up shown on a collapsed header: its children summed, first headline in navigation order. */
export function attentionForGroup(map: AttentionMap, id: RailGroupId): Attention | null {
  const group = RAIL_GROUPS.find((g) => g.id === id);
  let total = 0;
  let headline = "";
  for (const child of group?.items ?? []) {
    const entry = map[child.tab];
    if (!entry) continue;
    if (total === 0) headline = entry.headline;
    total += entry.count;
  }
  return total > 0 ? { count: total, headline } : null;
}
