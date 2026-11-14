import { describe, expect, it } from "vitest";

import { barChart, buildScoreboard, goldAtMinute } from "./postGame";
import { END_SEC, champions, finishedMatch, goldSamples, matchRecord } from "./postGameFixtures.testing";

describe("buildScoreboard: rows", () => {
  const board = buildScoreboard(finishedMatch());

  it("puts each team's five players top to bottom, with gold earned (purse plus spent) and damage", () => {
    expect(board.rows.blue.map((row) => row.role)).toEqual(["TOP", "JGL", "MID", "ADC", "SUP"]);
    const adc = board.rows.blue[3];
    expect(adc).toMatchObject({ name: "Paduck", level: 18, kills: 7, deaths: 2, assists: 8, cs: 301, gold: 24600, damage: 34700, side: "blue" });
  });

  it("lists the items the player owns (at most six), the trinket's icon key and the two summoner spells", () => {
    const top = board.rows.blue[0];
    expect(top.items).toEqual(["black_cleaver", "plated_steelcaps", "sunfire_aegis"]);
    expect(top.trinket).toBe("stealth_ward");
    expect(board.rows.blue[1].trinket).toBe("oracle_lens");
    expect(top.spells).toEqual(["flash", "teleport"]);
    const crowded = buildScoreboard(finishedMatch({ champions: champions({ items: ["a", "b", "c", "d", "e", "f", "g"] }) }));
    expect(crowded.rows.blue[0].items).toHaveLength(6);
  });

  it("leaves out what the engine did not send instead of writing a zero", () => {
    const sparse = buildScoreboard(finishedMatch({ champions: champions({ damageDealt: undefined, trinketKey: undefined, summonerSpells: undefined }) }));
    expect(sparse.rows.blue[0].damage).toBeNull();
    expect(sparse.rows.blue[0].trinket).toBeNull();
    expect(sparse.rows.blue[0].spells).toEqual([]);
    expect(sparse.totals.blue.damage).toBeNull();
  });
});

describe("buildScoreboard: totals", () => {
  const board = buildScoreboard(finishedMatch());

  it("takes kills and structures from the engine's team stats and sums the rest from the rows", () => {
    expect(board.totals.blue).toMatchObject({ kills: 21, deaths: 11, assists: 51, cs: 962, gold: 98700, damage: 96000, towers: 7, dragons: 4, barons: 1, won: true });
    expect(board.totals.red).toMatchObject({ kills: 11, gold: 90500, won: false });
  });

  it("counts the heralds from the recorded events of a match watched whole", () => {
    expect(board.totals.red.heralds).toBe(1);
    expect(board.totals.blue.heralds).toBe(0);
  });

  it("does not claim a herald count for a skipped match: the events after the skip are not all recorded", () => {
    const skipped = buildScoreboard(finishedMatch({ matchRecord: matchRecord({ skippedAtSec: 600 }) }));
    expect(skipped.totals.red.heralds).toBeNull();
    expect(buildScoreboard(finishedMatch({ matchRecord: undefined })).totals.red.heralds).toBeNull();
  });

  it("falls back to the players' own sums when the engine sent no team stats", () => {
    const bare = buildScoreboard(finishedMatch({ stats: undefined }));
    expect(bare.totals.blue.kills).toBe(21);
    expect(bare.totals.blue.towers).toBe(0);
  });
});

describe("buildScoreboard: the MVP", () => {
  it("is the winning team's best player by the score the old result screen used", () => {
    const board = buildScoreboard(finishedMatch());
    expect(board.mvp?.name).toBe("Paduck");
    expect(board.rows.blue.filter((row) => row.mvp)).toHaveLength(1);
    expect(board.rows.red.some((row) => row.mvp)).toBe(false);
  });

  it("follows the winner", () => {
    expect(buildScoreboard(finishedMatch({ winner: "red" })).mvp?.side).toBe("red");
  });

  it("is nobody when there is no winner", () => {
    expect(buildScoreboard(finishedMatch({ winner: null })).mvp).toBeNull();
  });
});

describe("barChart", () => {
  const board = buildScoreboard(finishedMatch());

  it("sorts each team by value, with its share of the team and its width against the biggest bar of both", () => {
    const chart = barChart(board, "damage");
    expect(chart).not.toBeNull();
    const blue = chart!.groups[0];
    expect(blue.side).toBe("blue");
    expect(blue.total).toBe(96000);
    expect(blue.rows.map((row) => row.name)).toEqual(["Paduck", "Nuc", "Rooster", "Sheo", "Trymbi"]);
    expect(blue.rows[0].share).toBeCloseTo(34700 / 96000, 5);
    expect(blue.rows[0].width).toBe(1);
    expect(blue.rows[4].width).toBeCloseTo(8800 / 34700, 5);
    expect(chart!.top.name).toBe("Paduck");
  });

  it("charts gold earned", () => {
    expect(barChart(board, "gold")!.groups[1].rows[0]).toMatchObject({ name: "Supa", value: 22500 });
  });

  it("has no damage chart when a player's damage was not sent: a zero would be a made-up bar", () => {
    const sparse = buildScoreboard(finishedMatch({ champions: champions({ damageDealt: undefined }) }));
    expect(barChart(sparse, "damage")).toBeNull();
    expect(barChart(sparse, "gold")).not.toBeNull();
  });
});

describe("goldAtMinute", () => {
  it("reads a player's gold at a minute the match was seen in", () => {
    const at10 = goldAtMinute(matchRecord(), "b-adc", 10);
    expect(at10).toBe(goldSamples()[10].players["b-adc"]);
  });

  it("is null for a minute nobody saw (a skip), for a match that ended sooner, and for a player not recorded", () => {
    const skipped = matchRecord({ gold: [goldSamples()[0], goldSamples()[1], goldSamples()[goldSamples().length - 1]] });
    expect(goldAtMinute(skipped, "b-adc", 10)).toBeNull();
    expect(goldAtMinute(matchRecord(), "b-adc", Math.floor(END_SEC / 60) + 5)).toBeNull();
    expect(goldAtMinute(matchRecord(), "nobody", 10)).toBeNull();
    expect(goldAtMinute(undefined, "b-adc", 10)).toBeNull();
  });
});
