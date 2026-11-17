/**
 * Pure rail-mode decision (NR1 spec, section 3). Tree shows the Club tree in the
 * rail; Split is the icon rail plus a docked panel. The sizes mirror the
 * `--nav-*` CSS tokens (`max(rem, px)`), so a CSS guard can compare them.
 */
export type RailMode = "tree" | "split";
export type RailPlatform = "android" | "desktop";

/** Direct rows and group headers: `--nav-row` = max(2rem, 32px). */
export const navRow = (r: number): number => Math.max(2 * r, 32);
/** Group children in the tree: `--nav-row-child` = max(1.75rem, 28px). */
export const navRowChild = (r: number): number => Math.max(1.75 * r, 28);
/** Icon-only utility cells: `--nav-cell` = max(2.25rem, 36px). */
export const navCell = (r: number): number => Math.max(2.25 * r, 36);
/** Tree rail width: `--rail-w-tree` = max(14rem, 192px). */
export const railWTree = (r: number): number => Math.max(14 * r, 192);

/** Rail padding 20, divider 17, Market gap 4, utility cluster border and padding 9. */
export const RAIL_STRUCTURAL_PX = 50;
/** Content width the 960 px minimum window already leaves at root 16. */
export const CONTENT_FLOOR_PX = 880;
/** Extra room required to re-enter Tree from Split, so a boundary size cannot flicker. */
export const HYSTERESIS_PX = 16;

/** The pinned utility cluster: Bug, Settings, Exit and Manager, icon-only. */
export const RAIL_CLUSTER_CELLS = 4;
export const RAIL_CLUSTER_COLUMNS = 4;

/** Height of the cluster: its rows of `--nav-cell`. `railNeed` and the cluster both read this. */
export function railClusterHeight(r: number): number {
  return Math.ceil(RAIL_CLUSTER_CELLS / RAIL_CLUSTER_COLUMNS) * navCell(r);
}

/** Height the tree needs: Club open, Market and World closed (8 rows, 10 children, 1 cell). */
export function railNeed(rootPx: number, reservedTop = 0): number {
  return (
    RAIL_STRUCTURAL_PX + 8 * navRow(rootPx) + 10 * navRowChild(rootPx) + railClusterHeight(rootPx) + reservedTop
  );
}

/** Width the tree needs: the tree rail plus the content floor. */
export function railMinWidth(rootPx: number): number {
  return railWTree(rootPx) + CONTENT_FLOOR_PX;
}

export interface RailModeInput {
  platform: RailPlatform;
  /** Dashboard body content box, CSS px (everything under the title bar). */
  slotW: number;
  slotH: number;
  /** Computed root font size in px. */
  rootPx: number;
  current: RailMode;
  /** Height taken from the rail by something pinned above the tree (phase 2 Go button). */
  reservedTop?: number;
}

export function decideRailMode({
  platform,
  slotW,
  slotH,
  rootPx,
  current,
  reservedTop = 0,
}: RailModeInput): RailMode {
  if (platform === "android") return "split";
  const margin = current === "split" ? HYSTERESIS_PX : 0;
  const fits =
    slotH >= railNeed(rootPx, reservedTop) + margin && slotW >= railMinWidth(rootPx) + margin;
  return fits ? "tree" : "split";
}
