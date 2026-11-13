import { describe, expect, it } from "vitest";
import items from "../../../../../assets/simulation/items.v1.json";
import { humanizeItemKey, itemDisplayName, loadItemNames, summonerSpellName, trinketItemKey } from "@/ui-v2/_legacy/components/match/itemNames";

describe("item names", () => {
  it("humanizes a key", () => {
    expect(humanizeItemKey("plated_steelcaps")).toBe("Plated Steelcaps");
  });

  it("falls back to the humanized key before the catalogue loads and for an unknown key", async () => {
    expect(itemDisplayName("plated_steelcaps", null)).toBe("Plated Steelcaps");
    const names = await loadItemNames();
    expect(itemDisplayName("not_an_item_at_all", names)).toBe("Not An Item At All");
  });

  it("gives the catalogue name of a known key", async () => {
    const names = await loadItemNames();
    expect(itemDisplayName("mercurys_treads", names)).toBe("Mercury's Treads");
    expect(itemDisplayName("plated_steelcaps", names)).toBe("Plated Steelcaps");
  });

  it("names every item of the catalogue", async () => {
    const names = await loadItemNames();
    for (const item of items.items) expect(names[item.key], item.key).toBeTruthy();
  });

  it("names the summoner spells and maps the trinkets to catalogue keys", async () => {
    expect(["flash", "ignite", "heal", "smite", "teleport"].map(summonerSpellName)).toEqual(["Flash", "Ignite", "Heal", "Smite", "Teleport"]);
    const names = await loadItemNames();
    expect(itemDisplayName(trinketItemKey("wardingtotem")!, names)).toBe("Stealth Ward");
    expect(itemDisplayName(trinketItemKey("oraclelens")!, names)).toBe("Oracle Lens");
  });
});
