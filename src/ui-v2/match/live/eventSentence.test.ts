import { afterAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";

import { eventSentence, type CodedEventLike } from "./eventSentence";

const LOCALES = ["en", "es", "de", "fr", "it", "pt", "pt-BR", "tr"] as const;

const kill: CodedEventLike = {
  text: "Zed killed Ahri",
  type: "kill",
  code: "champion_killed",
  data: { actor: "Zed", actorId: "b-mid", target: "Ahri", targetId: "r-mid" },
};

/** One event per code the engine writes, each with the facts its sentence needs. */
const SAMPLES: ReadonlyArray<CodedEventLike> = [
  kill,
  { ...kill, code: "champion_killed", data: { ...kill.data, cause: "tower" } },
  { ...kill, code: "ignite_kill" },
  { text: "BLUE destroyed blue-top-outer", type: "tower", code: "structure_destroyed", data: { team: "blue", structure: "red-top-outer" } },
  { text: "RED secured OCEAN dragon", type: "dragon", code: "dragon_secured", data: { team: "red", dragonKind: "ocean" } },
  { text: "RED secured baron", type: "baron", code: "baron_secured", data: { team: "red" } },
  { text: "RED secured elder", type: "dragon", code: "elder_secured", data: { team: "red" } },
  { text: "RED secured rift herald", type: "info", code: "herald_secured", data: { team: "red" } },
  { text: "RED secured voidgrub", type: "info", code: "voidgrub_secured", data: { team: "red" } },
  { text: "RED cleared voidgrub camp", type: "info", code: "voidgrub_camp_cleared", data: { team: "red" } },
  { text: "BLUE secured Scuttle Top", type: "info", code: "objective_secured", data: { team: "blue", objective: "scuttle-top" } },
  { text: "BLUE deployed rift herald", type: "info", code: "herald_deployed", data: { team: "blue" } },
  { text: "Zed cleared Blue Wolves", type: "info", code: "camp_cleared", data: { actor: "Zed", objective: "wolves-blue" } },
  { text: "Zed skipped Blue Wolves", type: "info", code: "camp_skipped", data: { actor: "Zed", objective: "wolves-blue" } },
  { text: "Baron spawned", type: "spawn", code: "neutral_spawned", data: { objective: "baron" } },
  { text: "Blue Wolves despawned", type: "info", code: "neutral_despawned", data: { objective: "wolves-blue" } },
  { text: "Zed started recall", type: "recall", code: "recall_started", data: { actor: "Zed" } },
  { text: "Zed recall interrupted", type: "recall", code: "recall_interrupted", data: { actor: "Zed" } },
  { text: "Zed recalled", type: "recall", code: "recall_completed", data: { actor: "Zed" } },
  { text: "Zed activated Sweeper", type: "info", code: "sweeper_activated", data: { actor: "Zed" } },
  { text: "Zed summoned clone", type: "info", code: "unit_summoned", data: { actor: "Zed" } },
  { text: "Zed cast Heal", type: "info", code: "spell_cast", data: { actor: "Zed", spell: "heal" } },
  { text: "Zed cast Ultimate (execute)", type: "info", code: "spell_cast", data: { actor: "Zed", spell: "ultimate" } },
  { text: "Zed ignited Ahri", type: "info", code: "ignite_cast", data: { actor: "Zed", target: "Ahri" } },
  { text: "Zed bought black_cleaver", type: "info", code: "item_bought", data: { actor: "Zed", item: "black_cleaver" } },
  { text: "Minion wave spawned", type: "spawn", code: "wave_spawned" },
];

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("eventSentence in Spanish", () => {
  const compose = async (event: CodedEventLike) => {
    await i18n.changeLanguage("es");
    return eventSentence(event, i18n.t.bind(i18n));
  };

  it("writes a kill from the names in the data", async () => {
    expect(await compose(kill)).toBe("Zed eliminó a Ahri");
  });

  it("names the cause of a kill by a tower or a minion", async () => {
    expect(await compose(SAMPLES[1])).toBe("Zed eliminó a Ahri (torre)");
  });

  it("names the structure and the team of a destroyed turret", async () => {
    expect(await compose(SAMPLES[3])).toBe("Azul destruyó la torre exterior (superior)");
  });

  it("names the dragon by its kind", async () => {
    expect(await compose(SAMPLES[4])).toBe("Rojo aseguró el Dragón oceánico");
  });

  it("keeps the English line of an event that has no code (old reports)", async () => {
    const old: CodedEventLike = { text: "BLUE secured baron", type: "baron" };
    expect(await compose(old)).toBe("BLUE secured baron");
  });

  it("keeps the English line of a code this build does not know", async () => {
    const newer: CodedEventLike = { text: "Something new happened", type: "info", code: "something_new" };
    expect(await compose(newer)).toBe("Something new happened");
  });

  it("keeps the English line when the data lacks a fact the sentence needs", async () => {
    const partial: CodedEventLike = { ...kill, data: { actor: "Zed" } };
    expect(await compose(partial)).toBe("Zed killed Ahri");
  });

  it("keeps the English line of a camp or a spell it has no word for", async () => {
    const camp: CodedEventLike = { text: "Mystery despawned", code: "neutral_despawned", data: { objective: "mystery" } };
    const spell: CodedEventLike = { text: "Zed cast Mystery", code: "spell_cast", data: { actor: "Zed", spell: "mystery" } };
    expect(await compose(camp)).toBe("Mystery despawned");
    expect(await compose(spell)).toBe("Zed cast Mystery");
  });

  it("is a translation, not the key", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.t("onAir.match.feed.waveSpawned")).toBe("Ha salido una oleada de súbditos");
  });
});

describe.each(LOCALES)("eventSentence in %s", (locale) => {
  it("composes a finished sentence for every code the engine writes", async () => {
    await i18n.changeLanguage(locale);
    for (const sample of SAMPLES) {
      const sentence = eventSentence(sample, i18n.t.bind(i18n));
      expect(sentence, `${sample.code} -> ${sentence}`).not.toMatch(/\{\{|onAir\.|match\./);
      expect(sentence.length, `${sample.code}`).toBeGreaterThan(0);
      if (locale !== "en") {
        expect(sentence, `${sample.code} is still the English line in ${locale}`).not.toBe(sample.text);
      }
    }
  });
});
