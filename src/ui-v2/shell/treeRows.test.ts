import { describe, expect, it } from "vitest";
import { equivalentRowId, treeKeyAction, type TreeRow } from "./treeRows";

// Visible rows in DOM order: Club open, Market closed.
const rows: TreeRow[] = [
  { id: "tab:Home", kind: "leaf", level: 0, parentId: null },
  { id: "group:club", kind: "header", level: 0, parentId: null, expanded: true },
  { id: "tab:Squad", kind: "child", level: 1, parentId: "group:club" },
  { id: "tab:Tactics", kind: "child", level: 1, parentId: "group:club" },
  { id: "group:market", kind: "header", level: 0, parentId: null, expanded: false },
  { id: "util:settings", kind: "utility", level: 0, parentId: null },
];
const at = (id: string) => rows.findIndex((r) => r.id === id);
const act = (id: string, key: string, mode?: "tree" | "split") =>
  treeKeyAction(rows, at(id), key, mode);

describe("treeKeyAction, vertical moves", () => {
  it("moves to the next and previous row", () => {
    expect(act("tab:Home", "ArrowDown")).toEqual({ type: "move", index: 1 });
    expect(act("tab:Tactics", "ArrowUp")).toEqual({ type: "move", index: at("tab:Squad") });
  });

  it("wraps at both ends, like the flat roving default", () => {
    expect(act("util:settings", "ArrowDown")).toEqual({ type: "move", index: 0 });
    expect(act("tab:Home", "ArrowUp")).toEqual({ type: "move", index: rows.length - 1 });
  });

  it("jumps to the first and last visible row with Home and End", () => {
    expect(act("tab:Squad", "Home")).toEqual({ type: "move", index: 0 });
    expect(act("tab:Squad", "End")).toEqual({ type: "move", index: rows.length - 1 });
  });
});

describe("treeKeyAction, Right", () => {
  it("expands a collapsed header and leaves focus on it", () => {
    expect(act("group:market", "ArrowRight")).toEqual({ type: "expand", id: "group:market" });
  });

  it("enters the first child of an open header", () => {
    expect(act("group:club", "ArrowRight")).toEqual({ type: "move", index: at("tab:Squad") });
  });

  it("does nothing on a child, a leaf or a utility", () => {
    for (const id of ["tab:Squad", "tab:Home", "util:settings"]) {
      expect(act(id, "ArrowRight")).toEqual({ type: "none" });
    }
  });

  it("does nothing on an open header that has no visible child", () => {
    const bare: TreeRow[] = [{ id: "group:club", kind: "header", level: 0, parentId: null, expanded: true }];
    expect(treeKeyAction(bare, 0, "ArrowRight")).toEqual({ type: "none" });
  });
});

describe("treeKeyAction, Left", () => {
  it("returns from a child to its parent header", () => {
    expect(act("tab:Tactics", "ArrowLeft")).toEqual({ type: "move", index: at("group:club") });
  });

  it("collapses an open header", () => {
    expect(act("group:club", "ArrowLeft")).toEqual({ type: "collapse", id: "group:club" });
  });

  it("does nothing on a collapsed header, a leaf or a utility", () => {
    for (const id of ["group:market", "tab:Home", "util:settings"]) {
      expect(act(id, "ArrowLeft")).toEqual({ type: "none" });
    }
  });
});

describe("treeKeyAction, Enter and Space", () => {
  it.each(["Enter", " "])("navigates a leaf and a child on %j", (key) => {
    expect(act("tab:Home", key)).toEqual({ type: "activate", id: "tab:Home" });
    expect(act("tab:Squad", key)).toEqual({ type: "activate", id: "tab:Squad" });
  });

  it.each(["Enter", " "])("toggles a header on %j", (key) => {
    expect(act("group:club", key)).toEqual({ type: "toggle", id: "group:club" });
    expect(act("group:market", key)).toEqual({ type: "toggle", id: "group:market" });
  });

  it.each(["Enter", " "])("activates a utility on %j", (key) => {
    expect(act("util:settings", key)).toEqual({ type: "activate", id: "util:settings" });
  });
});

describe("treeKeyAction, other keys", () => {
  it("leaves letters and digits to the type-ahead", () => {
    expect(act("tab:Home", "s")).toEqual({ type: "none" });
    expect(act("tab:Home", "3")).toEqual({ type: "none" });
  });

  it("makes Escape a no-op outside Split", () => {
    expect(act("tab:Squad", "Escape")).toEqual({ type: "none" });
    expect(act("tab:Squad", "Escape", "tree")).toEqual({ type: "none" });
  });

  it("is inert for an empty list or an out-of-range index", () => {
    expect(treeKeyAction([], 0, "ArrowDown")).toEqual({ type: "none" });
    expect(treeKeyAction(rows, -1, "ArrowRight")).toEqual({ type: "none" });
    expect(treeKeyAction(rows, 99, "Enter")).toEqual({ type: "none" });
  });
});

describe("treeKeyAction, Split cross-column moves", () => {
  // Split: a rail column (stops, then utilities) and a docked panel for the active group.
  const split: TreeRow[] = [
    { id: "tab:Home", kind: "leaf", level: 0, parentId: null, column: "rail" },
    { id: "group:club", kind: "leaf", level: 0, parentId: null, column: "rail", hasPanel: true },
    { id: "group:market", kind: "leaf", level: 0, parentId: null, column: "rail" },
    { id: "util:settings", kind: "utility", level: 0, parentId: null, column: "rail" },
    { id: "tab:Squad", kind: "child", level: 1, parentId: "group:club", column: "panel" },
    { id: "tab:Tactics", kind: "child", level: 1, parentId: "group:club", column: "panel", active: true },
    { id: "tab:Training", kind: "child", level: 1, parentId: "group:club", column: "panel" },
  ];
  const at = (id: string) => split.findIndex((r) => r.id === id);
  const go = (id: string, key: string) => treeKeyAction(split, at(id), key, "split");

  it("Right on a group stop with a panel moves to the active panel child", () => {
    expect(go("group:club", "ArrowRight")).toEqual({ type: "move", index: at("tab:Tactics") });
  });

  it("Right enters the first panel child when none is active", () => {
    const none = split.map((r) => ({ ...r, active: false }));
    expect(treeKeyAction(none, at("group:club"), "ArrowRight", "split")).toEqual({
      type: "move",
      index: at("tab:Squad"),
    });
  });

  it("Right does nothing on a stop without a panel, or on the panel itself", () => {
    expect(go("group:market", "ArrowRight")).toEqual({ type: "none" });
    expect(go("tab:Home", "ArrowRight")).toEqual({ type: "none" });
    expect(go("tab:Squad", "ArrowRight")).toEqual({ type: "none" });
  });

  it("Left in the panel returns to the owning group stop, and does nothing in the rail", () => {
    expect(go("tab:Tactics", "ArrowLeft")).toEqual({ type: "move", index: at("group:club") });
    expect(go("group:club", "ArrowLeft")).toEqual({ type: "none" });
    expect(go("util:settings", "ArrowLeft")).toEqual({ type: "none" });
  });

  it("Escape in the panel returns to the owning stop; elsewhere it does nothing", () => {
    expect(go("tab:Training", "Escape")).toEqual({ type: "move", index: at("group:club") });
    expect(go("group:club", "Escape")).toEqual({ type: "none" });
  });

  it("Up, Down, Home and End stay inside the column of the current row, wrapping there", () => {
    expect(go("util:settings", "ArrowDown")).toEqual({ type: "move", index: at("tab:Home") });
    expect(go("tab:Home", "ArrowUp")).toEqual({ type: "move", index: at("util:settings") });
    expect(go("tab:Tactics", "ArrowDown")).toEqual({ type: "move", index: at("tab:Training") });
    expect(go("tab:Training", "ArrowDown")).toEqual({ type: "move", index: at("tab:Squad") });
    expect(go("tab:Tactics", "Home")).toEqual({ type: "move", index: at("tab:Squad") });
    expect(go("tab:Tactics", "End")).toEqual({ type: "move", index: at("tab:Training") });
    expect(go("group:club", "End")).toEqual({ type: "move", index: at("util:settings") });
  });

  it("activates a stop or a panel child on Enter", () => {
    expect(go("group:club", "Enter")).toEqual({ type: "activate", id: "group:club" });
    expect(go("tab:Squad", " ")).toEqual({ type: "activate", id: "tab:Squad" });
  });
});

describe("equivalentRowId (focus across a Tree/Split flip)", () => {
  const ids = (list: string[]) => list.map((id) => ({ id, kind: "leaf" as const, level: 0 as const, parentId: null }));

  it("keeps an id that still exists", () => {
    expect(equivalentRowId(ids(["tab:Squad", "group:club"]), "tab:Squad")).toBe("tab:Squad");
  });

  it("maps a tab whose row is gone to its group stop", () => {
    expect(equivalentRowId(ids(["tab:Home", "group:club", "util:bug"]), "tab:Tactics")).toBe("group:club");
  });

  it("falls back to the first row when nothing matches", () => {
    expect(equivalentRowId(ids(["tab:Home", "group:club"]), "tab:Nowhere")).toBe("tab:Home");
    expect(equivalentRowId([], "tab:Home")).toBeNull();
  });
});
