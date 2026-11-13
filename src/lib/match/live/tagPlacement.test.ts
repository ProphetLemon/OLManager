import { describe, expect, it } from "vitest";
import { bubbleDiameterPx } from "@/lib/match/live/mapGeometry";
import {
  nexusLabelObstacle,
  pitObstacle,
  placeTags,
  TAG_GAP_PX,
  type TagBox,
  type TagFormSizes,
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

describe("placeTags around the label of an objective pit", () => {
  const pit = pitObstacle({ x: 0.5, y: 0.5 });

  it("builds the box of a pit from its glyph down to the end of its label", () => {
    expect(pit.x0).toBeCloseTo(0.5 - 66 / 520, 8);
    expect(pit.x1).toBeCloseTo(0.5 + 66 / 520, 8);
    expect(pit.y0).toBeLessThan(0.5);
    expect(pit.y1).toBeCloseTo(0.5 + (17 + 44) / 520, 8);
    expect(pitObstacle({ x: 0.5, y: 0.5 }, 2).y1).toBeGreaterThan(pit.y1);
  });

  it("puts a tag under a champion when nothing is there, and not on the pit label when something is", () => {
    const standing = [champ("a", 0.5, 0.5)];
    expect(placeTags(standing).a).toMatchObject({ slot: "below" });

    const result = placeTags(standing, undefined, { obstacles: [pit] });
    expect(result.a).not.toMatchObject({ slot: "below" });
    expect(result.a.form).not.toBe("none");
    expect(overlap(boxOf(result.a), pit)).toBe(false);
  });

  it("keeps every tag off the box, whatever slot it takes", () => {
    const result = placeTags(
      [champ("a", 0.5, 0.56), champ("b", 0.44, 0.5, { sub: "Fighting" }), champ("c", 0.56, 0.5)],
      undefined,
      { obstacles: [pit] },
    );
    for (const [id, box] of placedBoxes(result)) expect(overlap(box, pit), id).toBe(false);
  });

  it("lets go of a slot that the label now covers, even when it was the previous one", () => {
    const standing = [champ("a", 0.5, 0.5)];
    const before = placeTags(standing);
    const after = placeTags(standing, before, { obstacles: [pit] });
    expect(after.a).not.toMatchObject({ slot: "below" });
  });

  it("falls back to a badge for a champion with a state when the label leaves no slot", () => {
    const wall: TagBox = { x0: 0, y0: 0, x1: 1, y1: 1 };
    expect(placeTags([champ("a", 0.5, 0.5, { sub: "Fighting" })], undefined, { obstacles: [wall] }).a).toEqual({ form: "badge" });
    expect(placeTags([champ("a", 0.5, 0.5)], undefined, { obstacles: [wall] }).a).toEqual({ form: "none" });
  });
});

describe("placeTags for the real size of the map", () => {
  const width = (placement: TagPlacement) => {
    const box = boxOf(placement);
    return box.x1 - box.x0;
  };

  it("gives a tag a bigger share of a smaller map, because its size is in pixels", () => {
    const at = (sizePx: number) => width(placeTags([champ("a", 0.5, 0.5)], undefined, { sizePx }).a);
    expect(at(368)).toBeGreaterThan(at(520));
    expect(at(520)).toBeGreaterThan(at(660));
    expect(at(520)).toBeCloseTo(width(placeTags([champ("a", 0.5, 0.5)]).a), 8);
  });

  it("keeps tags apart on a 474 px map, where a nominal solve would let them touch", () => {
    // Two champions whose tags sit side by side below them: 0.1 of the map is 52 px at 520 and 47 px at 474.
    const pair = [champ("a", 0.45, 0.5, { name: "KORVANX" }), champ("b", 0.55, 0.5, { name: "DELLANX" })];
    for (const sizePx of [368, 474, 520, 660]) {
      const boxes = placedBoxes(placeTags(pair, undefined, { sizePx }));
      expect(boxes).toHaveLength(2);
      expect(overlap(boxes[0][1], boxes[1][1]), `at ${sizePx}`).toBe(false);
    }
  });
});

/**
 * Where the browser puts a tag, worked out from the marker's CSS and not from the solver: below the
 * bubble 11 px past its edge, above and beside it 8 px, an anchored tag reaching 6 px past the edge.
 * Pixels, with the origin at the top left of the map.
 */
function renderedBox(
  pos: { x: number; y: number },
  placement: TagPlacement,
  sizePx: number,
  size: { w: number; h: number },
) {
  if (!("slot" in placement)) throw new Error("expected a placed tag");
  const r = bubbleDiameterPx(sizePx) / 2;
  const cx = pos.x * sizePx;
  const cy = pos.y * sizePx;
  let x0 = cx - size.w / 2;
  if (placement.slot === "below" || placement.slot === "above") {
    if (placement.align === "start") x0 = cx - (r + 6);
    if (placement.align === "end") x0 = cx + (r + 6) - size.w;
    const y0 = placement.slot === "below" ? cy + r + 11 : cy - (r + 8) - size.h;
    return { x0, y0, x1: x0 + size.w, y1: y0 + size.h };
  }
  const y0 = cy - size.h / 2;
  x0 = placement.slot === "right" ? cx + r + 8 : cx - r - 8 - size.w;
  return { x0, y0, x1: x0 + size.w, y1: y0 + size.h };
}

type Px = ReturnType<typeof renderedBox>;
const touches = (a: Px, b: Px, by = 0) => !(a.x1 + by < b.x0 || b.x1 + by < a.x0 || a.y1 + by < b.y0 || b.y1 + by < a.y0);

describe("placeTags with the measured size of the tags", () => {
  const SIZE = 474;
  const full = (w: number, h = 18): TagFormSizes => ({ full: { w, h }, compact: { w: Math.min(w, 34), h } });

  it("builds the box of a form from its measured size, not from its letters", () => {
    const wide = placeTags([champ("a", 0.5, 0.5, { sizes: { full: { w: 120, h: 30 } } })], undefined, { sizePx: SIZE }).a;
    const box = boxOf(wide);
    expect((box.x1 - box.x0) * SIZE).toBeCloseTo(120, 6);
    expect((box.y1 - box.y0) * SIZE).toBeCloseTo(30, 6);
  });

  it("estimates the form that was not measured, and a form whose box has no size yet", () => {
    const estimated = boxOf(placeTags([champ("a", 0.5, 0.5)], undefined, { sizePx: SIZE }).a);
    const unmeasured = boxOf(
      placeTags([champ("a", 0.5, 0.5, { sizes: { full: { w: 0, h: 0 } } })], undefined, { sizePx: SIZE }).a,
    );
    expect(unmeasured).toEqual(estimated);
    const onlyCompact = boxOf(
      placeTags([champ("a", 0.5, 0.5, { sizes: { compact: { w: 20, h: 18 } } })], undefined, { sizePx: SIZE }).a,
    );
    expect(onlyCompact).toEqual(estimated);
  });

  it("keeps two tags apart when the font is wider than a character count says", () => {
    // Two-letter names: 27 px each by the estimate, 80 px in a wide face. They stand 47 px apart.
    const pair = [
      champ("a", 0.45, 0.5, { name: "AB", sizes: full(80) }),
      champ("b", 0.55, 0.5, { name: "CD", sizes: full(80) }),
    ];
    const result = placeTags(pair, undefined, { sizePx: SIZE });
    const [first, second] = pair.map((entry) => renderedBox(entry.pos, result[entry.id], SIZE, { w: 80, h: 18 }));
    expect(touches(first, second)).toBe(false);
    expect(result.a).toMatchObject({ slot: "below" });
    expect(result.b).not.toMatchObject({ slot: "below" });
  });

  it("agrees with where the browser puts the tag: the solver's box is the rendered box", () => {
    const sizes = new Map<string, number>(FIGHT.map((entry, index) => [entry.id, 40 + index * 6]));
    const sized = FIGHT.map((entry) => ({ ...entry, sizes: full(sizes.get(entry.id) ?? 50, entry.sub ? 30 : 18) }));
    const result = placeTags(sized, undefined, { sizePx: SIZE });
    for (const entry of sized) {
      const placement = result[entry.id];
      if (!("box" in placement)) continue;
      const size = entry.sizes[placement.form];
      if (!size) throw new Error("test data");
      const rendered = renderedBox(entry.pos, placement, SIZE, size);
      expect(placement.box.x0 * SIZE, `${entry.id} x0`).toBeCloseTo(rendered.x0, 6);
      expect(placement.box.y0 * SIZE, `${entry.id} y0`).toBeCloseTo(rendered.y0, 6);
      expect(placement.box.x1 * SIZE, `${entry.id} x1`).toBeCloseTo(rendered.x1, 6);
      expect(placement.box.y1 * SIZE, `${entry.id} y1`).toBeCloseTo(rendered.y1, 6);
    }
  });

  it("places no two real-sized tags on each other in a five-champion cluster, with the gap between them", () => {
    // Widths of the face in the page (Barlow Condensed, 12 px): "NUC" 32, "SUP" 31, "ROO" 31, "SHE" 30, "MYR" 33.
    const cluster: TagChampion[] = [
      champ("nuc", 0.4, 0.62, { name: "NUC", sub: "Regreso 2,3s", subCompact: "Reg 2,3", sizes: { full: { w: 70, h: 30 }, compact: { w: 50, h: 30 } } }),
      champ("sup", 0.42, 0.64, { name: "SUP", sub: "Objetivo", subCompact: "Obj.", sizes: { full: { w: 62, h: 30 }, compact: { w: 34, h: 30 } } }),
      champ("roo", 0.44, 0.61, { name: "ROO", sizes: { full: { w: 54, h: 18 }, compact: { w: 31, h: 18 } } }),
      champ("she", 0.41, 0.59, { name: "SHE", sub: "Peleando", subCompact: "Pelea", sizes: { full: { w: 66, h: 30 }, compact: { w: 40, h: 30 } } }),
      champ("myr", 0.43, 0.6, { name: "MYR", sub: "Peleando", subCompact: "Pelea", sizes: { full: { w: 66, h: 30 }, compact: { w: 40, h: 30 } } }),
    ];
    const result = placeTags(cluster, undefined, { sizePx: SIZE });
    const placed = cluster.flatMap((entry) => {
      const placement = result[entry.id];
      if (!("slot" in placement)) return [];
      const size = entry.sizes?.[placement.form];
      if (!size) throw new Error("test data");
      return [{ id: entry.id, box: renderedBox(entry.pos, placement, SIZE, size) }];
    });
    expect(placed.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(touches(placed[i].box, placed[j].box, TAG_GAP_PX - 0.5), `${placed[i].id} touches ${placed[j].id}`).toBe(false);
      }
    }
    // What found no room says so: a badge for a state, nothing for the rest. Never a tag on a tag.
    for (const entry of cluster) {
      if (!("slot" in result[entry.id])) expect(["badge", "none"]).toContain(result[entry.id].form);
    }
  });
});

/** The box of a placed tag when its champion is `t` of the way from `pos` to `to`. */
function boxAt(champion: TagChampion, placement: TagPlacement | undefined, t: number): TagBox {
  const box = boxOf(placement);
  const dx = ((champion.to?.x ?? champion.pos.x) - champion.pos.x) * t;
  const dy = ((champion.to?.y ?? champion.pos.y) - champion.pos.y) * t;
  return { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
}

const SAMPLES = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];

/** Ten champions in a clump, each walking half way to the middle of it: the worst moment of a team fight. */
function movingCluster(): TagChampion[] {
  const centre = { x: 0.5, y: 0.47 };
  return Array.from({ length: 10 }, (_, index) => {
    const pos = { x: 0.43 + (index % 5) * 0.035, y: 0.43 + Math.floor(index / 5) * 0.08 };
    return champ(`m${index}`, pos.x, pos.y, {
      sub: index % 2 === 0 ? "Fighting" : undefined,
      to: { x: pos.x + (centre.x - pos.x) * 0.5, y: pos.y + (centre.y - pos.y) * 0.5 },
      sizes: { full: { w: 62, h: 30 }, compact: { w: 36, h: 18 } },
    });
  });
}

describe("tags of champions on the move", () => {
  it("never lets two tags intersect at any moment between one solve and the next, in a moving clump", () => {
    const cluster = movingCluster();
    const result = placeTags(cluster, undefined, { sizePx: 574 });
    const placed = cluster.filter((entry) => "box" in result[entry.id]);
    // A clump that dense still shows some names; the test is void if the solver gave all of them up.
    expect(placed.length).toBeGreaterThan(2);
    for (const t of SAMPLES) {
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const a = boxAt(placed[i], result[placed[i].id], t);
          const b = boxAt(placed[j], result[placed[j].id], t);
          expect(overlap(a, b), `${placed[i].id} and ${placed[j].id} at t=${t}`).toBe(false);
        }
      }
    }
  });

  it("keeps a tag off every other bubble at every moment of the way", () => {
    const cluster = movingCluster();
    const result = placeTags(cluster, undefined, { sizePx: 574 });
    const reach = bubbleDiameterPx(574) / 2 / 574;
    for (const champion of cluster.filter((entry) => "box" in result[entry.id])) {
      for (const other of cluster.filter((entry) => entry.id !== champion.id)) {
        for (const t of SAMPLES) {
          const x = other.pos.x + ((other.to?.x ?? other.pos.x) - other.pos.x) * t;
          const y = other.pos.y + ((other.to?.y ?? other.pos.y) - other.pos.y) * t;
          const bubble = { x0: x - reach, y0: y - reach, x1: x + reach, y1: y + reach };
          expect(overlap(boxAt(champion, result[champion.id], t), bubble), `${champion.id} over ${other.id} at t=${t}`).toBe(false);
        }
      }
    }
  });

  it("gives two champions who walk the same way each a tag: only their relative motion counts", () => {
    const sizes = { full: { w: 62, h: 30 }, compact: { w: 36, h: 18 } };
    const together = [
      champ("a", 0.4, 0.5, { sizes, to: { x: 0.6, y: 0.5 } }),
      champ("b", 0.4, 0.66, { sizes, to: { x: 0.6, y: 0.66 } }),
    ];
    const result = placeTags(together, undefined, { sizePx: 574 });
    expect(result.a.form).toBe("full");
    expect(result.b.form).toBe("full");
    const alone = placeTags([champ("a", 0.4, 0.5, { sizes })], undefined, { sizePx: 574 });
    expect(result.a).toEqual(alone.a);
  });

  it("moves a tag out of the path of a champion who is walking into it", () => {
    const sizes = { full: { w: 62, h: 30 }, compact: { w: 36, h: 18 } };
    const still = [champ("a", 0.5, 0.5, { sizes }), champ("b", 0.5, 0.66, { sizes })];
    const meeting = [champ("a", 0.5, 0.5, { sizes }), champ("b", 0.5, 0.66, { sizes, to: { x: 0.5, y: 0.52 } })];
    const calm = placeTags(still, undefined, { sizePx: 574 });
    const walked = placeTags(meeting, undefined, { sizePx: 574 });
    expect(calm.a).toMatchObject({ slot: "below" });
    expect(walked.a).not.toEqual(calm.a);
    for (const t of SAMPLES) {
      if ("box" in walked.a && "box" in walked.b) {
        expect(overlap(boxAt(meeting[0], walked.a, t), boxAt(meeting[1], walked.b, t)), `at t=${t}`).toBe(false);
      }
    }
  });

  it("keeps a tag inside the map at the end of the way too", () => {
    const result = placeTags([champ("a", 0.5, 0.5, { to: { x: 0.5, y: 0.97 } })], undefined, { sizePx: 574 });
    const placement = result.a;
    if ("box" in placement) {
      expect(boxAt(champ("a", 0.5, 0.5, { to: { x: 0.5, y: 0.97 } }), placement, 1).y1).toBeLessThanOrEqual(0.997);
    }
    expect(placement).toMatchObject({ slot: "above" });
  });
});

describe("the nexus label", () => {
  const nexus = { x: 0.1, y: 0.88 };

  it("covers the marker, the health bar and the word under it", () => {
    const box = nexusLabelObstacle(nexus, 574);
    const radius = (574 * 0.052 > 48 ? 48 : Math.max(24, 574 * 0.052)) / 2;
    expect(box.x0).toBeLessThan(nexus.x - 28 / 574 + 1e-9);
    expect(box.x1).toBeGreaterThan(nexus.x + 28 / 574 - 1e-9);
    expect(box.y0).toBeCloseTo(nexus.y - radius / 574, 6);
    expect(box.y1 - nexus.y).toBeGreaterThanOrEqual((radius + 30) / 574 - 1e-9);
  });

  it("keeps a tag off it", () => {
    const champion = champ("a", 0.1, 0.8, { sizes: { full: { w: 62, h: 30 }, compact: { w: 36, h: 18 } } });
    const free = placeTags([champion], undefined, { sizePx: 574 });
    expect(free.a).toMatchObject({ slot: "below" });
    const obstacle = nexusLabelObstacle(nexus, 574);
    const placed = placeTags([champion], undefined, { sizePx: 574, obstacles: [obstacle] });
    expect(placed.a).not.toMatchObject({ slot: "below" });
    if ("box" in placed.a) expect(overlap(placed.a.box, obstacle)).toBe(false);
  });
});
