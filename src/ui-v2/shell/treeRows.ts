import { groupForTab } from "./navModel";
import type { RailMode } from "./railMode";

/** What a visible rail row is: a direct stop, a group header, a header's child or a utility cell. */
export type TreeRowKind = "leaf" | "header" | "child" | "utility";

/** One visible row of the rail, in DOM order. Ids are stable across renders (`tab:Squad`, `group:club`, `util:settings`). */
export interface TreeRow {
  id: string;
  kind: TreeRowKind;
  level: 0 | 1;
  parentId: string | null;
  /** Headers only: whether the children are shown. */
  expanded?: boolean;
  /** Split: which column the row sits in. Up, Down, Home and End stay inside it. Absent in Tree. */
  column?: "rail" | "panel";
  /** Split, group stops: the docked panel lists this group's children. */
  hasPanel?: boolean;
  /** Split, panel rows: the row that owns the current page. */
  active?: boolean;
}

export type TreeKeyAction =
  | { type: "none" }
  | { type: "move"; index: number }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  | { type: "toggle"; id: string }
  | { type: "activate"; id: string };

const NONE: TreeKeyAction = { type: "none" };

/**
 * The keymap of the rail (NR1 spec, section 4) as a pure function over the visible rows.
 * Letters and digits return `none`: the roving hook's type-ahead handles them.
 * Split has two columns (`column`): the rail and the docked panel of the active group.
 * Right on a group stop that has a panel enters it (active child, else the first); Left and
 * Escape in the panel return to the owning stop. Elsewhere Left and Right do nothing.
 */
export function treeKeyAction(
  rows: readonly TreeRow[],
  index: number,
  key: string,
  mode: RailMode = "tree",
): TreeKeyAction {
  if (rows.length === 0) return NONE;
  const row = rows[index];
  if (!row) return NONE;

  // Vertical moves wrap inside the current column (the whole list in Tree).
  const column = row.column;
  const inColumn = rows.flatMap((r, i) => (r.column === column ? [i] : []));
  const slot = inColumn.indexOf(index);
  const vertical = (to: number): TreeKeyAction => ({ type: "move", index: inColumn[to] });
  const ownerIndex = rows.findIndex((r) => r.id === row.parentId);

  switch (key) {
    case "ArrowDown":
      return vertical((slot + 1) % inColumn.length);
    case "ArrowUp":
      return vertical((slot - 1 + inColumn.length) % inColumn.length);
    case "Home":
      return vertical(0);
    case "End":
      return vertical(inColumn.length - 1);
    case "ArrowRight": {
      if (mode === "split") {
        if (!row.hasPanel) return NONE;
        const panel = rows.flatMap((r, i) => (r.column === "panel" ? [i] : []));
        const target = panel.find((i) => rows[i].active) ?? panel[0];
        return target === undefined ? NONE : { type: "move", index: target };
      }
      if (row.kind !== "header") return NONE;
      if (!row.expanded) return { type: "expand", id: row.id };
      const first = rows.findIndex((r) => r.parentId === row.id);
      return first >= 0 ? { type: "move", index: first } : NONE;
    }
    case "ArrowLeft": {
      if (mode === "split") {
        return row.column === "panel" && ownerIndex >= 0 ? { type: "move", index: ownerIndex } : NONE;
      }
      if (row.kind === "child") {
        return ownerIndex >= 0 ? { type: "move", index: ownerIndex } : NONE;
      }
      return row.kind === "header" && row.expanded ? { type: "collapse", id: row.id } : NONE;
    }
    case "Enter":
    case " ":
      return row.kind === "header" ? { type: "toggle", id: row.id } : { type: "activate", id: row.id };
    case "Escape":
      return mode === "split" && row.column === "panel" && ownerIndex >= 0
        ? { type: "move", index: ownerIndex }
        : NONE;
    default:
      return NONE;
  }
}

/**
 * The row to refocus after the rail flips between Tree and Split: the same id when the new
 * mode has it, else a tab's group stop (a Tree child whose panel is not shown), else the first row.
 */
export function equivalentRowId(rows: readonly TreeRow[], id: string): string | null {
  if (rows.some((r) => r.id === id)) return id;
  if (id.startsWith("tab:")) {
    const group = groupForTab(id.slice("tab:".length));
    if (group && rows.some((r) => r.id === `group:${group}`)) return `group:${group}`;
  }
  return rows[0]?.id ?? null;
}
