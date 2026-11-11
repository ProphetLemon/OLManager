import { useEffect, useState } from "react";

/** Display name of every item of the catalogue, by item key. */
export type ItemNamesByKey = Record<string, string>;

let cachedNames: ItemNamesByKey | null = null;
let pendingNames: Promise<ItemNamesByKey> | null = null;

/** The catalogue (assets/simulation/items.v1.json, 177 KB) is local data, loaded once as its own chunk. No network request. */
export function loadItemNames(): Promise<ItemNamesByKey> {
  if (cachedNames) return Promise.resolve(cachedNames);
  pendingNames ??= import("../../../../../assets/simulation/items.v1.json").then((file) => {
    const names: ItemNamesByKey = {};
    for (const item of file.items as Array<{ key: string; name: string }>) names[item.key] = item.name;
    cachedNames = names;
    return names;
  });
  return pendingNames;
}

/** "plated_steelcaps" becomes "Plated Steelcaps". */
export function humanizeItemKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Name of an item. A key the catalogue does not know, or names not loaded yet, give the humanized key. */
export function itemDisplayName(key: string, names: ItemNamesByKey | null | undefined = cachedNames): string {
  return names?.[key] || humanizeItemKey(key);
}

/** The item names once the catalogue has loaded; null before. */
export function useItemNames(): ItemNamesByKey | null {
  const [names, setNames] = useState<ItemNamesByKey | null>(cachedNames);
  useEffect(() => {
    if (names) return;
    let active = true;
    void loadItemNames().then((loaded) => {
      if (active) setNames(loaded);
    });
    return () => {
      active = false;
    };
  }, [names]);
  return names;
}

const SUMMONER_SPELL_NAMES: Record<string, string> = {
  flash: "Flash",
  ignite: "Ignite",
  heal: "Heal",
  smite: "Smite",
  teleport: "Teleport",
};

/** Name of a summoner spell by its key; an unknown key gives the humanized key. */
export function summonerSpellName(key: string): string {
  const normalized = key.trim().toLowerCase();
  return SUMMONER_SPELL_NAMES[normalized] ?? humanizeItemKey(normalized);
}

/** Catalogue key of the trinket icon a champion carries. */
export function trinketItemKey(trinketKey: string | undefined): string | undefined {
  const key = trinketKey?.trim().toLowerCase();
  if (key === "wardingtotem") return "stealth_ward";
  if (key === "oraclelens") return "oracle_lens";
  return undefined;
}
