import { describe, expect, it } from "vitest";
import {
  placeTags,
  type TagBox,
  type TagChampion,
  type TagPlacement,
  type TagPlacements,
} from "@/lib/match/live/tagPlacement";

const champ = (id: string, x: number, y: number, extra: Partial<TagChampion> = {}): TagChampion => ({
  id,
  pos: { x, y },
  name: id.toUpperCase().padEnd(6, "X"),
  ...extra,
});

function boxOf(placement: TagPlacement | undefined): TagBox {
  if (!placement || !("box" in placement)) throw new Error("expected a placed tag");
  return placement.box;
}

const overlap = (a: TagBox, b: TagBox) => !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);

function placedBoxes(placements: TagPlacements): Array<[string, TagBox]> {
  return Object.entries(placements).flatMap(([id, placement]) =>
    "box" in placement ? [[id, placement.box] as [string, TagBox]] : [],
  );
}

/** The dense fight of the prototype (scene "fight", 21:10): ten champions, five of them with a state line. */
const FIGHT: TagChampion[] = [
  champ("korvan", 0.092, 0.5, { sub: "Fighting" }),
  champ("mirelle", 0.385, 0.345, { sub: "Objective" }),
  champ("tzuki", 0.465, 0.545, { sub: "Dead 22s", subCompact: "22s" }),
  champ("dellan", 0.905, 0.385, { sub: "Fighting" }),
  champ("pim", 0.855, 0.425),
  champ("hask", 0.15, 0.478, { sub: "Fighting" }),
  champ("ruvia", 0.77, 0.455),
  champ("oksa", 0.525, 0.465),
  champ("brannic", 0.925, 0.47, { sub: "Recall 3.9s", subCompact: "R 3.9" }),
  champ("yule", 0.958, 0.55),
];

describe("placeTags", () => {
  it("puts a lone tag below the bubble in the full form", () => {
    const result = placeTags([champ("a", 0.5, 0.5)]);
    expect(result.a).toMatchObject({ form: "full", slot: "below", align: "center" });
  });

  it("anchors the tag to the edge when the bubble is at the left or right border", () => {
    const left = placeTags([champ("a", 0.04, 0.5)]);
    const right = placeTags([champ("b", 0.96, 0.5)]);
    expect(left.a).toMatchObject({ slot: "below", align: "start" });
    expect(right.b).toMatchObject({ slot: "below", align: "end" });
    expect(boxOf(left.a).x0).toBeGreaterThanOrEqual(0.003);
    expect(boxOf(right.b).x1).toBeLessThanOrEqual(0.997);
  });

  it("never places two tags on top of each other, or a tag on another bubble, in the dense fight", () => {
    const result = placeTags(FIGHT);
    const boxes = placedBoxes(result);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlap(boxes[i][1], boxes[j][1]), `${boxes[i][0]} overlaps ${boxes[j][0]}`).toBe(false);
      }
    }
    const reach = 12.5 / 520 + 5 / 520;
    for (const [id, box] of boxes) {
      for (const other of FIGHT) {
        if (other.id === id) continue;
        const bubble = { x0: other.pos.x - reach, y0: other.pos.y - reach, x1: other.pos.x + reach, y1: other.pos.y + reach };
        expect(overlap(box, bubble), `${id} tag covers the bubble of ${other.id}`).toBe(false);
      }
    }
  });

  it("gives every champion with a state line a slot or a badge in the dense fight, never nothing", () => {
    const result = placeTags(FIGHT);
    for (const champion of FIGHT.filter((entry) => entry.sub)) {
      expect(result[champion.id].form, champion.id).not.toBe("none");
    }
    // BRANNIC is the recalling champion that lost his tag in the prototype.
    expect(["full", "compact", "badge"]).toContain(result.brannic.form);
  });

  it("falls back to a badge for a state tag with no free slot, and to nothing for a champion with no state", () => {
    // A champion in the middle of a ring of overlapping bubbles: every slot is covered.
    const ring: TagChampion[] = [];
    for (let row = -3; row <= 3; row += 1) {
      for (let col = -3; col <= 3; col += 1) {
        if (row === 0 && col === 0) continue;
        ring.push(champ(`n${row}_${col}`, 0.5 + col * 0.03, 0.5 + row * 0.03));
      }
    }
    const stateful = placeTags([champ("c", 0.5, 0.5, { sub: "Recall 3.9s", subCompact: "R 3.9" }), ...ring]);
    expect(stateful.c).toEqual({ form: "badge" });
    const stateless = placeTags([champ("c", 0.5, 0.5), ...ring]);
    expect(stateless.c).toEqual({ form: "none" });
  });

  it("drops to the compact form when only that fits", () => {
    // The long name needs a wide tag; blockers on both sides and above leave only a narrow gap below.
    const crowded = placeTags([
      champ("a", 0.5, 0.5, { name: "VERYLONGNAMEHERE" }),
      champ("belowRight", 0.6, 0.56),
      champ("belowLeft", 0.4, 0.56),
      champ("aboveRight", 0.6, 0.44),
      champ("aboveLeft", 0.4, 0.44),
      champ("right", 0.62, 0.5),
      champ("left", 0.38, 0.5),
    ]);
    expect(crowded.a).toMatchObject({ form: "compact", slot: "below" });
    const alone = placeTags([champ("a", 0.5, 0.5, { name: "VERYLONGNAMEHERE" })]);
    expect(alone.a.form).toBe("full");
  });

  it("chooses champions with a state line first, so they win a contested slot", () => {
    const stateless = champ("a", 0.5, 0.4);
    const stateful = champ("b", 0.5, 0.43, { sub: "Fighting" });
    const result = placeTags([stateless, stateful]);
    // Both want the space between them; the one with a state line sits where it would sit alone.
    const alone = placeTags([stateful]);
    expect(result.b).toEqual(alone.b);
  });

  it("keeps the previous slot while it stays clash-free", () => {
    const only = [champ("a", 0.5, 0.5)];
    const fresh = placeTags(only);
    expect(fresh.a).toMatchObject({ slot: "below" });
    // The previous solve had the tag above; nothing blocks it, so it stays above.
    const prev: TagPlacements = { a: { form: "full", slot: "above", align: "center", box: boxOf(fresh.a) } };
    const next = placeTags(only, prev);
    expect(next.a).toMatchObject({ form: "full", slot: "above" });
  });

  it("releases the previous slot when something now covers it", () => {
    const prev: TagPlacements = { a: { form: "full", slot: "above", align: "center", box: { x0: 0, y0: 0, x1: 0, y1: 0 } } };
    const next = placeTags([champ("a", 0.5, 0.5), champ("blocker", 0.5, 0.455)], prev);
    expect(next.a).not.toMatchObject({ slot: "above" });
    expect(next.a.form).not.toBe("none");
  });

  it("is deterministic: the same input gives the same output regardless of input order", () => {
    const forward = placeTags(FIGHT);
    const backward = placeTags([...FIGHT].reverse());
    expect(backward).toEqual(forward);
  });

  it("solves ten champions fast (guards an accidental cubic solver)", () => {
    placeTags(FIGHT); // warm up
    const runs = 200;
    const started = performance.now();
    for (let i = 0; i < runs; i += 1) placeTags(FIGHT);
    const perSolve = (performance.now() - started) / runs;
    expect(perSolve).toBeLessThan(2);
  });
});
