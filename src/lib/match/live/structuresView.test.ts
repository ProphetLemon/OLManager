import { describe, expect, it } from "vitest";

import { STRUCTURES_LAYOUT } from "@/lib/match/lolMapLayout";

import { structureDiameterPx } from "./mapGeometry";
import {
  CAMP_TIMER_KEY,
  PUSH_BADGE_GAP_PX,
  PUSH_BADGE_MARGIN_PX,
  campViews,
  placePushBadge,
  pushBadges,
  structureViews,
  wardViews,
  type StructureLike,
  type StructuresStateLike,
} from "./structuresView";

const tower = (over: Partial<StructureLike> = {}): StructureLike => ({
  id: "blue-mid-outer",
  team: "blue",
  kind: "tower",
  pos: { x: 0.4, y: 0.57 },
  hp: 3000,
  maxHp: 3000,
  alive: true,
  ...over,
});

const stateWith = (over: Partial<StructuresStateLike> = {}): StructuresStateLike => ({
  timeSec: 600,
  structures: [tower(), tower({ id: "red-mid-outer", team: "red", pos: { x: 0.6, y: 0.44 } })],
  ...over,
});

describe("structureViews", () => {
  it("shows no health bar for a structure at full health", () => {
    expect(structureViews(stateWith())[0]).toMatchObject({ dead: false, hpShare: null });
  });

  it("gives the share of health left once damaged", () => {
    const [view] = structureViews({ structures: [tower({ hp: 750 })] });
    expect(view.hpShare).toBeCloseTo(0.25);
  });

  it("marks a destroyed structure dead and gives it no health bar", () => {
    const [view] = structureViews({ structures: [tower({ alive: false, hp: 0 })] });
    expect(view).toMatchObject({ dead: true, hpShare: null });
  });

  it("keeps the team and the kind", () => {
    const views = structureViews(stateWith());
    expect(views.map(({ team, kind }) => `${team}:${kind}`)).toEqual(["blue:tower", "red:tower"]);
  });

  it("describes all 30 structures of the layout", () => {
    const all = STRUCTURES_LAYOUT.map((point) =>
      tower({ id: point.id, team: point.side, pos: { x: point.x, y: point.y } }),
    );
    expect(structureViews({ structures: all })).toHaveLength(30);
  });
});

describe("campViews", () => {
  it("is empty when the engine sends no timers", () => {
    expect(campViews({})).toEqual([]);
    expect(campViews({ neutralTimers: { entities: {} } })).toEqual([]);
  });

  it("tells an up camp from a cleared one, by the timer of that camp", () => {
    const views = campViews({
      neutralTimers: { entities: { "wolves-blue": { alive: true }, "gromp-red": { alive: false } } },
    });
    expect(Object.fromEntries(views.map((view) => [view.id, view.alive]))).toEqual({
      "blue-wolves": true,
      "red-gromp": false,
    });
  });

  it("places a camp in engine units and keeps its side", () => {
    const [view] = campViews({ neutralTimers: { entities: { "scuttle-top": { alive: true } } } });
    expect(view).toMatchObject({ id: "river-scuttle-top", side: "neutral" });
    expect(view.pos.x).toBeCloseTo(0.2845, 3);
    expect(view.pos.y).toBeCloseTo(0.3477, 3);
  });

  it("knows a timer for every camp of the layout", () => {
    expect(Object.keys(CAMP_TIMER_KEY)).toHaveLength(14);
  });
});

describe("wardViews", () => {
  const ward = (id: string, team: string, expiresAt?: number) => ({ id, team, pos: { x: 0.3, y: 0.3 }, expiresAt });

  it("lists the wards of both teams", () => {
    const views = wardViews({ timeSec: 100, wards: [ward("w1", "blue", 150), ward("w2", "red", 150)] });
    expect(views.map((view) => view.team)).toEqual(["blue", "red"]);
  });

  it("drops a ward whose time is up", () => {
    const views = wardViews({ timeSec: 100, wards: [ward("old", "blue", 100), ward("fresh", "red", 100.5)] });
    expect(views.map((view) => view.id)).toEqual(["fresh"]);
  });

  it("is empty when the engine sends no wards", () => {
    expect(wardViews({ timeSec: 100 })).toEqual([]);
  });
});

describe("pushBadges", () => {
  const plan = { active: true, targetId: "red-mid-outer", windowEndsAt: 631 };

  it("reads the plan of blue first and red second", () => {
    const badges = pushBadges(stateWith({ teamPush: [plan, { ...plan, targetId: "blue-mid-outer" }] }));
    expect(badges.map(({ team, targetId }) => `${team}>${targetId}`)).toEqual(["blue>red-mid-outer", "red>blue-mid-outer"]);
  });

  it("counts down to the end of the advantage", () => {
    const [badge] = pushBadges(stateWith({ teamPush: [plan, undefined] }));
    expect(badge).toMatchObject({ mode: "countdown", remainingSec: 31, team: "blue" });
    expect(badge.target).toEqual({ x: 0.6, y: 0.44 });
  });

  it("says nothing of time when the advantage has no end in sight", () => {
    const [badge] = pushBadges(stateWith({ teamPush: [{ ...plan, windowEndsAt: 590 }, undefined] }));
    expect(badge).toMatchObject({ mode: "open", remainingSec: 0 });
  });

  it("shows the final push with no countdown, because its window only rolls forward", () => {
    const [badge] = pushBadges(stateWith({ teamPush: [{ ...plan, ending: true, windowEndsAt: 660 }, undefined] }));
    expect(badge.mode).toBe("ending");
  });

  it("shows nothing for a team with no plan, or whose target has fallen", () => {
    expect(pushBadges(stateWith({ teamPush: [{ active: false, targetId: "red-mid-outer" }, undefined] }))).toEqual([]);
    expect(pushBadges(stateWith())).toEqual([]);
    const fallen = stateWith({
      structures: [tower({ id: "red-mid-outer", team: "red", alive: false })],
      teamPush: [plan, undefined],
    });
    expect(pushBadges(fallen)).toEqual([]);
  });
});

describe("placePushBadge", () => {
  const SIZE = 540;
  const BADGE = { w: 96, h: 24 };
  const radius = structureDiameterPx("tower", SIZE) / 2;

  /** The badge rectangle, from its centre. */
  const rect = (centre: { x: number; y: number }, box = BADGE) => ({
    left: centre.x - box.w / 2,
    right: centre.x + box.w / 2,
    top: centre.y - box.h / 2,
    bottom: centre.y + box.h / 2,
  });

  const byId = Object.fromEntries(STRUCTURES_LAYOUT.map((point) => [point.id, { x: point.x, y: point.y }]));

  it("sits above its structure when there is room", () => {
    const target = byId["blue-mid-outer"];
    const centre = placePushBadge(target, radius, BADGE, SIZE);
    expect(centre.x).toBeCloseTo(target.x * SIZE, 0);
    expect(centre.y).toBeCloseTo(target.y * SIZE - radius - PUSH_BADGE_GAP_PX - BADGE.h / 2, 0);
  });

  it("is not half clipped for the structures on the left and bottom edges", () => {
    for (const id of ["blue-top-outer", "blue-top-inner", "blue-bot-outer", "blue-nexus", "blue-bot-inhib-tower"]) {
      for (const box of [BADGE, { w: 140, h: 24 }, { w: 60, h: 40 }]) {
        const box1 = rect(placePushBadge(byId[id], radius, box, SIZE), box);
        expect(box1.left, id).toBeGreaterThanOrEqual(PUSH_BADGE_MARGIN_PX);
        expect(box1.top, id).toBeGreaterThanOrEqual(PUSH_BADGE_MARGIN_PX);
        expect(box1.right, id).toBeLessThanOrEqual(SIZE - PUSH_BADGE_MARGIN_PX);
        expect(box1.bottom, id).toBeLessThanOrEqual(SIZE - PUSH_BADGE_MARGIN_PX);
      }
    }
  });

  it("stays inside the map for every structure, on small and large maps", () => {
    for (const size of [320, 540, 660]) {
      for (const point of STRUCTURES_LAYOUT) {
        const box = rect(placePushBadge({ x: point.x, y: point.y }, radius, BADGE, size));
        expect(box.left, `${point.id}@${size}`).toBeGreaterThanOrEqual(0);
        expect(box.top, `${point.id}@${size}`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${point.id}@${size}`).toBeLessThanOrEqual(size);
        expect(box.bottom, `${point.id}@${size}`).toBeLessThanOrEqual(size);
      }
    }
  });

  it("goes below a structure at the top edge, where above does not fit", () => {
    const target = { x: 0.5, y: 0.03 };
    const centre = placePushBadge(target, radius, BADGE, SIZE);
    expect(centre.y).toBeGreaterThan(target.y * SIZE);
    expect(centre.y - BADGE.h / 2).toBeGreaterThanOrEqual(target.y * SIZE + radius);
  });

  it("never covers the structure it points at", () => {
    for (const point of STRUCTURES_LAYOUT) {
      const centre = placePushBadge({ x: point.x, y: point.y }, radius, BADGE, SIZE);
      const box = rect(centre);
      const x = point.x * SIZE;
      const y = point.y * SIZE;
      const covers = x > box.left && x < box.right && y > box.top && y < box.bottom;
      expect(covers, point.id).toBe(false);
    }
  });

  it("slides back inside the margin when the badge is wider than the room", () => {
    const wide = { w: 300, h: 24 };
    const box = rect(placePushBadge(byId["blue-top-outer"], radius, wide, 320), wide);
    expect(box.left).toBeGreaterThanOrEqual(PUSH_BADGE_MARGIN_PX);
  });
});
