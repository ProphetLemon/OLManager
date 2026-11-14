import { describe, expect, it } from "vitest";

import { KEY_EVENTS, END_SEC } from "./postGameFixtures.testing";
import { buildTimeline, placeMarkers, type TimelineEntry } from "./postGameTimeline";

const roster = [
  { id: "b-adc", name: "Paduck", team: "blue" as const },
  { id: "b-jgl", name: "Sheo", team: "blue" as const },
  { id: "r-top", name: "Myrwn", team: "red" as const },
];

describe("buildTimeline", () => {
  const timeline = buildTimeline(KEY_EVENTS, { complete: true, roster });

  it("keeps every key event in time order, with its kind and the side that did it", () => {
    expect(timeline.map((entry) => entry.kind)).toEqual([
      "firstBlood",
      "kill",
      "dragon",
      "dragon",
      "tower",
      "grub",
      "tower",
      "herald",
      "kill",
      "dragon",
      "baron",
      "inhibitor",
      "tower",
      "nexus",
    ]);
    expect(timeline.map((entry) => entry.side).slice(0, 5)).toEqual(["blue", "blue", "blue", "red", "red"]);
  });

  it("names a dragon's kind and finds the champion that acted, for the portrait", () => {
    expect(timeline[2].dragonKind).toBe("ocean");
    expect(timeline[0].actorId).toBe("b-adc");
    expect(timeline[8].actorId).toBe("r-top");
  });

  it("marks what a person looks for: first blood, Baron and the nexus", () => {
    expect(timeline.filter((entry) => entry.big).map((entry) => entry.kind)).toEqual(["firstBlood", "baron", "nexus"]);
  });

  it("does not call the first kill first blood when the match was skipped: earlier kills may be missing", () => {
    const partial = buildTimeline(KEY_EVENTS, { complete: false, roster });
    expect(partial.some((entry) => entry.kind === "firstBlood")).toBe(false);
    expect(partial[0].kind).toBe("kill");
  });

  it("reads a structure's kind from its id, and the side that took it down from the event", () => {
    const outer = timeline[4];
    expect(outer).toMatchObject({ kind: "tower", side: "red", structureOwner: "blue" });
    expect(timeline[13]).toMatchObject({ kind: "nexus", side: "blue", structureOwner: "red" });
  });

  it("takes the side of a kill from the team of the champion that acted when its data names no team", () => {
    const [byId, byName, byTeam] = buildTimeline(
      [
        { t: 10, text: "Paduck killed Supa", type: "kill", code: "champion_killed", data: { actor: "Paduck", actorId: "b-adc", target: "Supa" } },
        { t: 20, text: "Myrwn killed Sheo", type: "kill", code: "champion_killed", data: { actor: "Myrwn", target: "Sheo" } },
        { t: 30, text: "Paduck killed Supa", type: "kill", code: "champion_killed", data: { team: "red", actorId: "b-adc" } },
      ],
      { complete: true, roster },
    );
    expect(byId.side).toBe("blue");
    expect(byName.side).toBe("red");
    // What the event itself says about its team comes before what the roster says.
    expect(byTeam.side).toBe("red");
  });

  it("reads the side of an older event from its text, and ignores an event it cannot place", () => {
    const old = buildTimeline(
      [
        { t: 10, text: "RED destroyed a tower", type: "tower" },
        { t: 20, text: "something happened", type: "kill" },
      ],
      { complete: true, roster },
    );
    expect(old.map((entry) => entry.side)).toEqual(["red", null]);
  });
});

const entry = (t: number, kind: TimelineEntry["kind"], side: "blue" | "red" | null): TimelineEntry => ({
  id: `${kind}-${t}`,
  t,
  side,
  kind,
  big: false,
  dragonKind: null,
  structureOwner: null,
  actorId: null,
  event: { t, text: "", type: kind },
});

describe("placeMarkers", () => {
  it("puts epic objectives on one row and structures on another, each at its real time", () => {
    const { markers } = placeMarkers(
      [entry(600, "dragon", "blue"), entry(900, "tower", "red"), entry(1200, "kill", "blue")],
      1800,
    );
    expect(markers.map((marker) => [marker.kind, marker.row, marker.left])).toEqual([
      ["dragon", "epic", 600 / 1800],
      ["tower", "structure", 900 / 1800],
    ]);
  });

  it("stacks markers that would touch on the same row, and keeps the rail one level for ones that do not", () => {
    const apart = placeMarkers([entry(300, "dragon", "blue"), entry(900, "baron", "blue")], 1800);
    expect(apart.epicLevels).toBe(1);
    const close = placeMarkers([entry(300, "dragon", "blue"), entry(310, "herald", "red")], 1800);
    expect(close.markers.map((marker) => marker.level)).toEqual([0, 1]);
    expect(close.epicLevels).toBe(2);
  });

  it("merges a run of the same side's structures into one counted marker, like the last turrets and the nexus", () => {
    const { markers } = placeMarkers(
      [entry(1862, "inhibitor", "blue"), entry(1880, "tower", "blue"), entry(1894, "tower", "blue"), entry(END_SEC, "nexus", "blue")],
      END_SEC,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ count: 4, row: "structure", side: "blue" });
    expect(markers[0].entries).toHaveLength(4);
  });

  it("does not merge structures of the two sides", () => {
    const { markers } = placeMarkers([entry(1000, "tower", "blue"), entry(1005, "tower", "red")], 1800);
    expect(markers).toHaveLength(2);
  });
});
