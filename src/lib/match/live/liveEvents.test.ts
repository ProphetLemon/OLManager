import { describe, expect, it } from "vitest";
import {
  countVoidgrubs,
  parseEvent,
  parseFeed,
  readTeamBuffs,
  sideFromText,
  structureLabel,
  type RosterEntry,
} from "@/lib/match/live/liveEvents";

const ROSTER: RosterEntry[] = [
  { id: "b1", name: "KORVAN", team: "blue" },
  { id: "b2", name: "Mira Vale", team: "blue" },
  { id: "r1", name: "BRANNIC", team: "red" },
  { id: "r2", name: "Orla", team: "red" },
];

describe("parseEvent: kills", () => {
  it("reads a plain kill with both champions from the roster", () => {
    const e = parseEvent({ t: 301.2, text: "KORVAN killed BRANNIC", type: "kill" }, ROSTER);
    expect(e).toMatchObject({
      kind: "kill",
      side: "blue",
      cause: null,
      ignite: false,
      killer: { name: "KORVAN", id: "b1", team: "blue" },
      victim: { name: "BRANNIC", id: "r1", team: "red" },
    });
  });

  it("keeps the cause of a kill in brackets", () => {
    const e = parseEvent({ t: 10, text: "BRANNIC killed KORVAN (tower)", type: "kill" }, ROSTER);
    expect(e).toMatchObject({ kind: "kill", side: "red", cause: "tower", ignite: false });
  });

  it("reads a kill by ignite as a kill with the ignite flag and no cause", () => {
    const e = parseEvent({ t: 10, text: "Mira Vale ignited Orla", type: "kill" }, ROSTER);
    expect(e).toMatchObject({ kind: "kill", side: "blue", ignite: true, cause: null });
    expect((e as { victim: { id: string } }).victim.id).toBe("r2");
  });

  it("does not turn the ignite cast (type info) into a kill", () => {
    const e = parseEvent({ t: 10, text: "Mira Vale ignited Orla", type: "info" }, ROSTER);
    expect(e.kind).toBe("neutral");
  });

  it("splits on the roster when a name holds a kill verb", () => {
    const roster: RosterEntry[] = [
      { id: "b9", name: "Slain Mark", team: "blue" },
      { id: "r9", name: "Orla", team: "red" },
    ];
    const e = parseEvent({ t: 1, text: "Slain Mark killed Orla", type: "kill" }, roster);
    expect(e).toMatchObject({ kind: "kill", killer: { name: "Slain Mark", id: "b9" }, victim: { name: "Orla", id: "r9" } });
  });

  it("keeps names that are not in the roster, without a team", () => {
    const e = parseEvent({ t: 1, text: "Ghost killed Nobody", type: "kill" }, ROSTER);
    expect(e).toMatchObject({ kind: "kill", side: null, killer: { name: "Ghost", id: null, team: null } });
  });
});

describe("parseEvent: structures", () => {
  it("reads a tower with a structure label", () => {
    const e = parseEvent({ t: 600, text: "BLUE destroyed blue-top-outer", type: "tower" }, ROSTER);
    expect(e).toMatchObject({
      kind: "tower",
      side: "blue",
      structure: { id: "blue-top-outer", owner: "blue", part: "outer-tower", lane: "top" },
    });
  });

  it("reads the nexus", () => {
    const e = parseEvent({ t: 2052, text: "BLUE destroyed red-nexus", type: "nexus" }, ROSTER);
    expect(e).toMatchObject({ kind: "nexus", side: "blue", structure: { part: "nexus", owner: "red" } });
  });

  it.each([
    ["red-nexus-bot-tower", { owner: "red", part: "nexus-tower", lane: "bot" }],
    ["blue-nexus-top-tower", { owner: "blue", part: "nexus-tower", lane: "top" }],
    ["blue-inhib-mid", { owner: "blue", part: "inhibitor", lane: "mid" }],
    ["red-bot-inhib-tower", { owner: "red", part: "inhibitor-tower", lane: "bot" }],
    ["red-mid-inner", { owner: "red", part: "inner-tower", lane: "mid" }],
    ["blue-nexus", { owner: "blue", part: "nexus", lane: null }],
  ])("labels %s", (id, expected) => {
    expect(structureLabel(id)).toEqual({ id, ...expected });
  });

  it("labels every structure the engine layout knows", async () => {
    const { STRUCTURES_LAYOUT } = await import("@/lib/match/lolMapLayout");
    const unknown = STRUCTURES_LAYOUT.filter((s) => structureLabel(s.id).part === "unknown").map((s) => s.id);
    expect(unknown).toEqual([]);
  });

  it("keeps an unknown structure id as unknown instead of guessing", () => {
    expect(structureLabel("blue-top-sideways")).toEqual({ id: "blue-top-sideways", owner: "blue", part: "unknown", lane: null });
    expect(structureLabel("???")).toEqual({ id: "???", owner: null, part: "unknown", lane: null });
  });
});

describe("parseEvent: objectives", () => {
  it("reads a dragon with its kind", () => {
    const e = parseEvent({ t: 400, text: "RED secured CLOUD dragon", type: "dragon" }, ROSTER);
    expect(e).toMatchObject({ kind: "dragon", side: "red", dragonKind: "cloud" });
  });

  it("keeps a dragon of an unknown kind", () => {
    const e = parseEvent({ t: 400, text: "RED secured VOID dragon", type: "dragon" }, ROSTER);
    expect(e).toMatchObject({ kind: "dragon", dragonKind: null });
  });

  it("reads Elder (type dragon) apart from a dragon", () => {
    expect(parseEvent({ t: 1500, text: "BLUE secured elder", type: "dragon" }, ROSTER)).toMatchObject({ kind: "elder", side: "blue" });
  });

  it("reads Baron", () => {
    expect(parseEvent({ t: 1200, text: "BLUE secured baron", type: "baron" }, ROSTER)).toMatchObject({ kind: "baron", side: "blue" });
  });

  it.each([
    ["BLUE cleared voidgrub camp", "voidgrub-camp", "blue"],
    ["RED secured voidgrub", "voidgrub", "red"],
    ["RED secured rift herald", "herald", "red"],
    ["BLUE secured Scuttle Top", "scuttle", "blue"],
  ])("reads the info objective %s", (text, objective, side) => {
    expect(parseEvent({ t: 500, text, type: "info" }, ROSTER)).toMatchObject({ kind: "objective", objective, side });
  });

  it.each(["Scuttle Top despawned", "Scuttle Bot despawned", "Rift Herald despawned", "Voidgrubs despawned"])(
    "does not read the unclaimed line %s as an objective someone secured",
    (text) => {
      expect(parseEvent({ t: 500, text, type: "info" }, ROSTER)).toMatchObject({ kind: "neutral", side: null });
    },
  );

  it("keeps despawn lines out of the feed", () => {
    const feed = parseFeed([{ t: 500, text: "Scuttle Top despawned", type: "info" }], ROSTER);
    expect(feed).toEqual([]);
  });

  it("leaves other info lines neutral", () => {
    expect(parseEvent({ t: 0, text: "Match started", type: "info" }, ROSTER)).toMatchObject({ kind: "neutral", text: "Match started" });
  });
});

describe("parseEvent: bad input", () => {
  it.each([
    [{ t: 1, text: "", type: "kill" }],
    [{ t: 1, text: "just words", type: "kill" }],
    [{ t: 1, text: "killed", type: "kill" }],
    [{ t: 1, text: "garbage", type: "tower" }],
    [{ t: 1, text: "BLUE secured something", type: "dragon" }],
    [{ t: 1, text: "BLUE did a thing", type: "wibble" }],
    [{}],
    [{ t: Number.NaN, text: undefined, type: undefined }],
  ])("returns a neutral entry without throwing for %j", (ev) => {
    expect(() => parseEvent(ev, ROSTER)).not.toThrow();
    expect(parseEvent(ev, ROSTER).kind).toBe("neutral");
  });

  it("survives null, undefined and a missing roster", () => {
    expect(parseEvent(null).kind).toBe("neutral");
    expect(parseEvent(undefined).kind).toBe("neutral");
    expect(parseEvent({ t: 1, text: "A killed B", type: "kill" })).toMatchObject({ kind: "kill", side: null });
  });
});

describe("parseFeed", () => {
  const events = [
    { t: 0, text: "Match started", type: "info" },
    { t: 100, text: "BLUE spawned something", type: "spawn" },
    { t: 200, text: "KORVAN killed BRANNIC", type: "kill" },
    { t: 210, text: "BLUE secured baron", type: "baron" },
    { t: 220, text: "RED secured voidgrub", type: "info" },
    { t: 220, text: "RED secured voidgrub", type: "info" },
    { t: 230, text: "nonsense", type: "kill" },
  ];

  it("lists the newest first and leaves out spawns and plain info lines", () => {
    const feed = parseFeed(events, ROSTER);
    expect(feed.map((e) => e.kind)).toEqual(["neutral", "objective", "objective", "baron", "kill"]);
  });

  it("gives repeated lines distinct, stable ids", () => {
    const ids = parseFeed(events, ROSTER).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The same events, one more appended: the older entries keep their ids.
    const later = parseFeed([...events, { t: 240, text: "BLUE secured baron", type: "baron" }], ROSTER).map((e) => e.id);
    for (const id of ids) expect(later).toContain(id);
  });

  it("respects the limit and empty input", () => {
    expect(parseFeed(events, ROSTER, 2)).toHaveLength(2);
    expect(parseFeed([], ROSTER)).toEqual([]);
    expect(parseFeed(undefined, ROSTER)).toEqual([]);
    expect(parseFeed(events, ROSTER, 0)).toEqual([]);
  });

  it("never shows more than the limit of a full 200 event log", () => {
    const log = Array.from({ length: 200 }, (_, i) => ({ t: i, text: "KORVAN killed BRANNIC", type: "kill" }));
    expect(parseFeed(log, ROSTER, 8)).toHaveLength(8);
  });
});

describe("sideFromText", () => {
  it("reads the team token at the start, case-insensitively", () => {
    expect(sideFromText("BLUE secured baron")).toBe("blue");
    expect(sideFromText("red destroyed x")).toBe("red");
    expect(sideFromText("HOME secured baron")).toBe("blue");
    expect(sideFromText("AWAY secured baron")).toBe("red");
    expect(sideFromText("Bluebird killed Redwood")).toBeNull();
    expect(sideFromText("")).toBeNull();
  });
});

describe("voidgrubs", () => {
  const grubEvents = [
    { t: 1, text: "BLUE secured voidgrub", type: "info" },
    { t: 2, text: "BLUE secured voidgrub", type: "info" },
    { t: 3, text: "RED secured voidgrub", type: "info" },
    { t: 4, text: "RED cleared voidgrub camp", type: "info" },
  ];

  it("counts one per grub line", () => {
    expect(countVoidgrubs(grubEvents, "blue")).toBe(2);
    expect(countVoidgrubs(grubEvents, "red")).toBe(1);
  });

  it("reads a camp clear with no grub lines as a full camp, and caps at three", () => {
    expect(countVoidgrubs([{ t: 1, text: "RED cleared voidgrub camp", type: "info" }], "red")).toBe(3);
    const many = Array.from({ length: 5 }, (_, i) => ({ t: i, text: "BLUE secured voidgrub", type: "info" }));
    expect(countVoidgrubs(many, "blue")).toBe(3);
    expect(countVoidgrubs(undefined, "blue")).toBe(0);
  });

  it("falls back to the events when teamBuffs is absent", () => {
    expect(readTeamBuffs({ events: grubEvents }, "blue").voidgrubStacks).toBe(2);
  });

  it("prefers the runtime count over the events", () => {
    const state = { events: grubEvents, teamBuffs: { blue: { voidgrub_stacks: 1 } } };
    expect(readTeamBuffs(state, "blue").voidgrubStacks).toBe(1);
  });
});

describe("readTeamBuffs", () => {
  const buffs = {
    blue: {
      baron_until: 1560.5,
      elder_until: 0,
      voidgrub_stacks: 2,
      dragon_history: ["cloud", "ocean"],
      dragon_stacks: 2,
      soul_kind: null,
    },
    red: { baron_until: 0, elder_until: 1700, voidgrub_stacks: 0, dragon_history: [], dragon_stacks: 0, soul_kind: "infernal" },
  };

  it("reads the snake_case fields from teamBuffs", () => {
    expect(readTeamBuffs({ teamBuffs: buffs }, "blue")).toEqual({
      baronUntil: 1560.5,
      elderUntil: 0,
      voidgrubStacks: 2,
      dragonHistory: ["cloud", "ocean"],
      dragonStacks: 2,
      soulKind: null,
    });
    expect(readTeamBuffs({ teamBuffs: buffs }, "red")).toMatchObject({ elderUntil: 1700, soulKind: "infernal" });
  });

  it("finds the buffs under team_buffs and under extra", () => {
    expect(readTeamBuffs({ team_buffs: buffs }, "blue").baronUntil).toBe(1560.5);
    expect(readTeamBuffs({ extra: { teamBuffs: buffs } }, "blue").baronUntil).toBe(1560.5);
  });

  it("reads zero for everything when the runtime sends nothing, and never throws", () => {
    const empty = { baronUntil: 0, elderUntil: 0, voidgrubStacks: 0, dragonHistory: [], dragonStacks: 0, soulKind: null };
    for (const state of [undefined, null, {}, 42, "x", [], { teamBuffs: 5 }, { teamBuffs: { blue: "x" } }]) {
      expect(readTeamBuffs(state, "blue")).toEqual(empty);
    }
  });

  it("ignores malformed values inside the buffs", () => {
    const state = { teamBuffs: { blue: { baron_until: "soon", dragon_history: ["cloud", 7, null], voidgrub_stacks: 9 } } };
    expect(readTeamBuffs(state, "blue")).toMatchObject({ baronUntil: 0, dragonHistory: ["cloud"], voidgrubStacks: 3 });
  });
});
