import { describe, expect, it } from "vitest";
import { treeKeyAction, type TreeRow } from "./treeRows";

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

  it("closes the panel on Escape in Split", () => {
    expect(act("tab:Squad", "Escape", "split")).toEqual({ type: "close" });
  });

  it("is inert for an empty list or an out-of-range index", () => {
    expect(treeKeyAction([], 0, "ArrowDown")).toEqual({ type: "none" });
    expect(treeKeyAction(rows, -1, "ArrowRight")).toEqual({ type: "none" });
    expect(treeKeyAction(rows, 99, "Enter")).toEqual({ type: "none" });
  });
});

describe("treeKeyAction, Split cross-column moves", () => {
  // Stubbed in unit 1: Split keeps the flat behaviour until the panel exists (unit 4).
  it("does not act on Right or Left yet", () => {
    expect(act("group:club", "ArrowRight", "split")).toEqual({ type: "none" });
    expect(act("tab:Squad", "ArrowLeft", "split")).toEqual({ type: "none" });
  });
  it.todo("unit 4: Right on a group stop enters the panel (active child, else first)");
  it.todo("unit 4: Left in the panel returns to the owning group stop");
});
