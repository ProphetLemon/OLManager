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
}

export type TreeKeyAction =
  | { type: "none" }
  | { type: "move"; index: number }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  | { type: "toggle"; id: string }
  | { type: "activate"; id: string }
  | { type: "close" };

const NONE: TreeKeyAction = { type: "none" };

/**
 * The keymap of the rail (NR1 spec, section 4) as a pure function over the visible rows.
 * Letters and digits return `none`: the roving hook's type-ahead handles them.
 * Cross-column moves of Split (Right into the panel, Left back) are not wired yet (unit 4).
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

  switch (key) {
    case "ArrowDown":
      return { type: "move", index: (index + 1) % rows.length };
    case "ArrowUp":
      return { type: "move", index: (index - 1 + rows.length) % rows.length };
    case "Home":
      return { type: "move", index: 0 };
    case "End":
      return { type: "move", index: rows.length - 1 };
    case "ArrowRight": {
      if (mode === "split" || row.kind !== "header") return NONE;
      if (!row.expanded) return { type: "expand", id: row.id };
      const first = rows.findIndex((r) => r.parentId === row.id);
      return first >= 0 ? { type: "move", index: first } : NONE;
    }
    case "ArrowLeft": {
      if (mode === "split") return NONE;
      if (row.kind === "child") {
        const parent = rows.findIndex((r) => r.id === row.parentId);
        return parent >= 0 ? { type: "move", index: parent } : NONE;
      }
      return row.kind === "header" && row.expanded ? { type: "collapse", id: row.id } : NONE;
    }
    case "Enter":
    case " ":
      return row.kind === "header" ? { type: "toggle", id: row.id } : { type: "activate", id: row.id };
    case "Escape":
      return mode === "split" ? { type: "close" } : NONE;
    default:
      return NONE;
  }
}
