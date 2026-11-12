import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import items from "../../../../../assets/simulation/items.v1.json";
import { humanizeItemKey, itemDisplayName, loadItemNames, summonerSpellName, trinketItemKey } from "@/ui-v2/_legacy/components/match/itemNames";
import { LecLowerThirdPanel } from "@/ui-v2/_legacy/components/match/lol-prototype/ui/panels";
import type { ChampionState } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

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

describe("scoreboard icons", () => {
  it("carry the real name as alt and title once the names are loaded", async () => {
    const champion = {
      id: "p1", team: "blue", role: "TOP", name: "Garen", hp: 100, maxHp: 100, alive: true, respawnAt: 0, xp: 0, level: 1, cs: 0,
      kills: 0, deaths: 0, assists: 0, gold: 0, spentGold: 0, items: ["mercurys_treads"], trinketKey: "wardingtotem",
      summonerSpells: [{ key: "flash", cdUntil: 0 }, { key: "ignite", cdUntil: 0 }],
    } as unknown as ChampionState;
    render(<LecLowerThirdPanel champions={[champion]} timeSec={0} />);
    await waitFor(() => expect(screen.getByAltText("Mercury's Treads")).toHaveAttribute("title", "Mercury's Treads"));
    expect(screen.getByAltText("Stealth Ward")).toHaveAttribute("title", "Stealth Ward");
    expect(screen.getByAltText("Flash")).toHaveAttribute("title", "Flash");
    expect(screen.getByAltText("Ignite")).toHaveAttribute("title", "Ignite");
  });
});
