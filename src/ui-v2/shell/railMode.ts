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
/** The Tree's Go row: `--go-row` = max(2.5rem, 40px). */
export const goRow = (r: number): number => Math.max(2.5 * r, 40);
/** The Go row's margin: 5 px above it and 5 below. */
export const GO_ROW_MARGIN_PX = 10;
/** What the Tree's Go row takes from the rail's height (R30): 50 at roots 12 to 16, 55 at 18, 60 at 20. */
export const goReserve = (r: number): number => goRow(r) + GO_ROW_MARGIN_PX;

/** Rail padding 20, divider 17, Market gap 4, utility cluster border and padding 9. */
export const RAIL_STRUCTURAL_PX = 50;
/**
 * The px-fixed chrome the real layout spends, none of it rem-scaled (a rem part would
 * outgrow the allowance at the large roots: it did, by 2 px at XL).
 */
export const RAIL_STRUCTURAL_PARTS = {
  listPadding: 12,
  divider: 17,
  marketGap: 4,
  clusterChrome: 9,
  /** Slack the spec's 50 px table keeps over the 42 px of real chrome. */
  safetyMargin: 8,
} as const;
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
  /** Height taken from the rail by something pinned above the tree: the Go row, `goReserve`. */
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

/** `--hit`: max(2.75rem, 24px) on desktop, max(2.75rem, 48px) when the root is flagged android. */
export const hitFor = (r: number, platform: RailPlatform = "desktop"): number =>
  Math.max(2.75 * r, platform === "android" ? 48 : 24);
/** `--nav-icon`: max(1.25rem, 18px). */
export const navIcon = (r: number): number => Math.max(1.25 * r, 18);

/** The direct stops plus the group launchers of the Split rail (the eight, employed). */
export const SPLIT_STOPS = 8;
/** Android: Home, Inbox, Schedule, Club, Market, World and More (News, Social and the utilities live in More). */
export const ANDROID_STOPS = 7;
/** Android rail padding, top and bottom: 7 x 48 + 16 = 352. */
export const ANDROID_RAIL_PADDING_PX = 16;

/**
 * Height of one labelled Split stop: the rem padding (0.375rem twice), the icon, the 0.125rem
 * gap and `lines` of 1rem label, never under `--hit` of the platform. Mirrors RailItem's classes.
 */
export function splitStopHeight(r: number, lines: number, platform: RailPlatform = "desktop"): number {
  return Math.max(hitFor(r, platform), 0.75 * r + navIcon(r) + 0.125 * r + lines * r);
}

/**
 * What the Split rail spends on its stops. Desktop adds the Go cell at the top of the stops
 * column (R31), a divider and the stacked utility cluster; Android has neither the cell nor
 * the cluster (Go is a stop there, the utilities are in the More menu) and only pads.
 */
export function splitNeed(
  r: number,
  labels: "labels" | "icons",
  lines: number,
  stops = SPLIT_STOPS,
  platform: RailPlatform = "desktop",
): number {
  const perStop = labels === "labels" ? splitStopHeight(r, lines, platform) : navCell(r);
  if (platform === "android") return stops * perStop + ANDROID_RAIL_PADDING_PX;
  const divider = 0.75 * r + 1;
  const cluster = RAIL_CLUSTER_CELLS * navCell(r) + RAIL_STRUCTURAL_PARTS.clusterChrome;
  const goCell = navCell(r);
  return goCell + stops * perStop + divider + cluster;
}

export interface SplitLabelsInput {
  /** Rail height: the dashboard body under the title bar. */
  slotH: number;
  rootPx: number;
  /** The most lines any stop label wraps to (1 or 2). */
  labelLines: number;
  /** Stops in the rail: 8, or 7 while the Club group is hidden (Android: always 7). */
  stops?: number;
  current?: "labels" | "icons";
  platform?: RailPlatform;
}

/**
 * R13: labelled stops while they fit the rail's height, else icon-only cells at `--nav-cell`.
 * A navigation rail never scrolls its stops out of view. Re-entering labels needs 16 px to spare.
 * Touch has no hover and the IconTip needs keyboard focus, so Android only uses this to report.
 */
export function splitLabelsFit({
  slotH,
  rootPx,
  labelLines,
  stops,
  current = "labels",
  platform = "desktop",
}: SplitLabelsInput): "labels" | "icons" {
  const count = stops ?? (platform === "android" ? ANDROID_STOPS : SPLIT_STOPS);
  const margin = current === "icons" ? HYSTERESIS_PX : 0;
  return slotH >= splitNeed(rootPx, "labels", labelLines, count, platform) + margin ? "labels" : "icons";
}
