import { useNavMemoryStore } from "@/store/navMemoryStore";
import { usePaletteStore } from "@/store/paletteStore";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Settings } from "lucide-react";

import { useRovingFocus } from "@/hooks/useRovingFocus";
import { SideSheet } from "@/ui-v2/sheet/SideSheet";
import FloatingBugButton from "@/ui-v2/_legacy/components/dashboard/FloatingBugButton";
import { GO_ID, GoButton } from "@/ui-v2/shell/GoButton";
import { ANDROID_DIRECT, RailSplitPanel, RailSplitStops } from "@/ui-v2/shell/RailSplit";
import { RAIL_LABEL_CLASS, RAIL_STOP_INSET_REM } from "@/ui-v2/shell/RailItem";
import { useFadeMask } from "@/ui-v2/shell/useFadeMask";
import { RailTree } from "@/ui-v2/shell/RailTree";
import { RailCell, RailCluster } from "@/ui-v2/shell/RailUtility";
import type { AttentionMap } from "@/ui-v2/shell/attention";
import { splitLabelsFit, type RailMode, type RailPlatform } from "@/ui-v2/shell/railMode";
import { equivalentRowId, treeKeyAction, type TreeRow } from "@/ui-v2/shell/treeRows";
import {
  RAIL_DIRECT,
  RAIL_GROUPS,
  groupForTab,
  isGroupOpen,
  resolveGroupLanding,
  type RailGroupId,
} from "@/ui-v2/shell/navModel";
import type { ShellBadges } from "@/ui-v2/shell/shellTypes";
import { cn } from "@/ui-v2/lib/utils";

interface Props {
  activeTab: string;
  onNavClick: (tab: string) => void;
  unreadMessagesCount: number;
  pendingOffersCount?: number;
  managerName: string | null;
  managerFullName?: string | null;
  managerAvatar?: string | null;
  teamName: string | null;
  teamLogo: string | null;
  isUnemployed: boolean;
  onNavigateSettings: () => void;
  onExitClick: () => void;
  playerCount?: number;
  teamCount?: number;
  staffCount?: number;
  /** Drops the visible labels; names stay available to assistive tech. */
  compact?: boolean;
  /** Tree shows the Club tree in the rail; Split is the icon rail with a docked panel. */
  railMode?: RailMode;
  /** Measurements behind `railMode`, exposed as data attributes for QA. */
  railSlot?: { slotW: number; slotH: number; need: number; rootPx?: number };
  /** Android always gets Split: More menu, touch sizes, no Tree and no icon-only stops. */
  platform?: RailPlatform;
  /** What needs a call, per tab; drawn on the Tree rows and the panel rows. */
  attention?: AttentionMap;
  /** Android: a section chosen in a group sheet, run once the sheet has closed. Defaults to `onNavClick`. */
  onSheetNavigate?: (tab: string) => void;
}

interface Stop {
  id: string;
  activate: () => void;
}

export function DashboardSidebarV2({
  activeTab,
  onNavClick,
  unreadMessagesCount,
  pendingOffersCount = 0,
  managerName,
  managerFullName,
  managerAvatar,
  isUnemployed,
  onNavigateSettings,
  onExitClick,
  playerCount = 0,
  teamCount = 0,
  staffCount = 0,
  compact = false,
  railMode = "split",
  railSlot,
  platform = "desktop",
  attention,
  onSheetNavigate,
}: Props) {
  const { t, i18n } = useTranslation();
  // The end-of-season screen keeps the icon rail whatever the size says.
  const android = platform === "android";
  const tree = railMode === "tree" && !compact && !android;

  const badges: ShellBadges = useMemo(
    () => ({
      unread: unreadMessagesCount,
      offers: pendingOffersCount,
      players: playerCount,
      teams: teamCount,
      staff: staffCount,
    }),
    [unreadMessagesCount, pendingOffersCount, playerCount, teamCount, staffCount],
  );

  // Last tab seen inside each group, so a launcher reopens where the user left.
  // Held in a store so it survives the dashboard unmounting for Settings or a match.
  const lastVisited = useNavMemoryStore((s) => s.lastByGroup);
  const rememberTab = useNavMemoryStore((s) => s.rememberTab);
  useEffect(() => {
    rememberTab(activeTab);
  }, [activeTab, rememberTab]);

  // The bug report is opened from the roving widget (Enter on its cell), so its modal is controlled here.
  const [bugOpen, setBugOpen] = useState(false);
  // Android: the group whose sections are open in the side sheet (the rail docks no panel there).
  const [sheetGroup, setSheetGroup] = useState<RailGroupId | null>(null);
  const sheetActivate = useRef<((payload: unknown) => void) | null>(null);
  const landingRef = useRef<HTMLElement | null>(null);
  const openPalette = usePaletteStore((s) => s.openPalette);
  const openGroups = useNavMemoryStore((s) => s.openGroups);
  const toggleGroup = useNavMemoryStore((s) => s.toggleGroup);

  const groups = useMemo(
    () => RAIL_GROUPS.filter((g) => !(isUnemployed && g.hiddenWhenUnemployed)),
    [isUnemployed],
  );

  const panelGroup = useMemo(() => {
    if (android) return groups.find((g) => g.id === sheetGroup) ?? null;
    if (tree || compact) return null;
    const id = groupForTab(activeTab);
    return groups.find((g) => g.id === id) ?? null;
  }, [android, sheetGroup, tree, compact, activeTab, groups]);

  // The visible rows in DOM order, with ids that mean the same in both modes
  // (`tab:Squad`, `group:club`, `util:settings`) so focus can follow a flip.
  const rows: TreeRow[] = useMemo(() => {
    const out: TreeRow[] = [];
    const rail = tree ? undefined : ("rail" as const);
    // Go is the first row in every mode (spec section 7.1): Up from Home and the Home key reach it.
    out.push({ id: GO_ID, kind: "utility", level: 0, parentId: null, column: rail });
    for (const i of RAIL_DIRECT) {
      if (android && !ANDROID_DIRECT.includes(i.tab)) continue;
      out.push({ id: `tab:${i.tab}`, kind: "leaf", level: 0, parentId: null, column: rail });
    }
    for (const g of groups) {
      if (tree) {
        const open = isGroupOpen(openGroups, g.id);
        out.push({ id: `group:${g.id}`, kind: "header", level: 0, parentId: null, expanded: open });
        if (open) {
          for (const i of g.items) {
            out.push({ id: `tab:${i.tab}`, kind: "child", level: 1, parentId: `group:${g.id}` });
          }
        }
      } else {
        out.push({
          id: `group:${g.id}`,
          kind: "leaf",
          level: 0,
          parentId: null,
          column: "rail",
          hasPanel: panelGroup?.id === g.id,
        });
      }
    }
    // Android keeps the utilities in the bar's More menu (PhoneMoreMenu): the rail has no cells.
    for (const u of android ? [] : ["bug", "settings", "exit", "manager"]) {
      out.push({ id: `util:${u}`, kind: "utility", level: 0, parentId: null, column: rail });
    }
    if (panelGroup) {
      for (const i of panelGroup.items) {
        out.push({
          id: `tab:${i.tab}`,
          kind: "child",
          level: 1,
          parentId: `group:${panelGroup.id}`,
          column: "panel",
          active: i.tab === activeTab,
        });
      }
    }
    return out;
  }, [tree, android, groups, openGroups, panelGroup, activeTab]);

  const stops: Stop[] = useMemo(
    () =>
      rows.map((r) => {
        if (r.id.startsWith("group:")) {
          const id = r.id.slice("group:".length) as RailGroupId;
          return {
            id: r.id,
            activate: tree
              ? () => toggleGroup(id)
              : android
                ? () => setSheetGroup(id)
                : () => onNavClick(resolveGroupLanding(id, lastVisited)),
          };
        }
        if (r.id === GO_ID) return { id: r.id, activate: () => openPalette(GO_ID) };
        if (r.id === "util:bug") return { id: r.id, activate: () => setBugOpen(true) };
        if (r.id === "util:settings") return { id: r.id, activate: onNavigateSettings };
        if (r.id === "util:exit") return { id: r.id, activate: onExitClick };
        if (r.id === "util:manager") return { id: r.id, activate: () => onNavClick("Manager") };
        // A section in the sheet closes it first; the owner navigates once it has closed.
        if (android && r.column === "panel") return { id: r.id, activate: () => sheetActivate.current?.(r.id.slice("tab:".length)) };
        return { id: r.id, activate: () => onNavClick(r.id.slice("tab:".length)) };
      }),
    [rows, tree, android, toggleGroup, lastVisited, onNavClick, onNavigateSettings, onExitClick, openPalette],
  );

  // The row the user last moved to wins until the active tab changes; else the active tab's
  // row: its header while a Tree group is collapsed, its launcher in Split.
  const [roving, setRoving] = useState<{ tab: string; id: string | null; panelId: string | null }>({
    tab: activeTab,
    id: null,
    panelId: null,
  });
  if (roving.tab !== activeTab) setRoving({ tab: activeTab, id: null, panelId: null });
  const activeRowId = (() => {
    // On Android these live in the bar's More, so no stop is current and the tab stop is Go.
    if (android && (activeTab === "Manager" || activeTab === "News" || activeTab === "Social")) return GO_ID;
    if (activeTab === "Manager") return "util:manager";
    const g = groupForTab(activeTab);
    if (!g) return `tab:${activeTab}`;
    if (!groups.some((x) => x.id === g)) return "";
    return tree && isGroupOpen(openGroups, g) ? `tab:${activeTab}` : `group:${g}`;
  })();
  // A remembered row survives a flip when it still exists or has a group stop to stand in for it.
  const remembered = (() => {
    if (!roving.id) return null;
    const eq = equivalentRowId(rows, roving.id);
    return eq === roving.id || (roving.id.startsWith("tab:") && eq?.startsWith("group:")) ? eq : null;
  })();
  const currentRowId = remembered ?? activeRowId;
  const controlledIndex = stops.findIndex((s) => s.id === currentRowId);

  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  // The keymap needs `setActiveIndex` from the hook it feeds, so it lives in a ref.
  const keymapRef = useRef<(e: React.KeyboardEvent, i: number) => boolean>(() => false);
  const { activeIndex, shouldFocus, setActiveIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: stops.length,
    columns: 1,
    index: controlledIndex,
    focusOnMount: false,
    orientation: "vertical",
    onSelect: (i) => stopsRef.current[i]?.activate(),
    getItemLabel: (i) => {
      const el = itemRefs.current[stops[i]?.id ?? ""];
      // Go's row and stop are named by their content, with no title or aria-label (R90).
      return el?.title || el?.getAttribute("aria-label") || el?.textContent?.trim() || "";
    },
    onKey: (e, i) => keymapRef.current(e, i),
  });

  keymapRef.current = (e, roving) => {
    // The row that has focus is the one that acts, whatever the roving state says yet.
    const focused = stopIndexOf(e.target);
    const i = focused >= 0 ? focused : roving;
    // Browser and OS shortcuts (Alt+Left = back) are not ours: skip the roving default too.
    if (e.altKey || e.ctrlKey || e.metaKey) return true;
    const action = treeKeyAction(rows, i, e.key, tree ? "tree" : "split");
    // The sheet is modal: a key never leaves its list for the (inert) rail. Escape is left to the sheet, which closes.
    if (android && action.type === "move" && rows[action.index]?.column !== rows[i]?.column) {
      if (e.key !== "Escape") e.preventDefault();
      return true;
    }
    const arrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key);
    switch (action.type) {
      case "move":
        e.preventDefault();
        setActiveIndex(action.index);
        return true;
      case "expand":
      case "collapse":
      case "toggle":
        e.preventDefault();
        toggleGroup(action.id.slice("group:".length) as RailGroupId);
        return true;
      case "activate":
        e.preventDefault();
        stopsRef.current[i]?.activate();
        return true;
      default:
        // "Nothing" means nothing: the roving default must not move focus either.
        if (arrow) e.preventDefault();
        return arrow;
    }
  };

  // Depends on the focus intent only: `stops` is rebuilt whenever the parent passes new
  // callbacks, and re-running on that would pull focus back into the rail.
  useEffect(() => {
    if (!shouldFocus || activeIndex < 0) return;
    itemRefs.current[stopsRef.current[activeIndex]?.id ?? ""]?.focus();
  }, [shouldFocus, activeIndex]);

  // Only keys pressed on a roving stop drive the widget. The modals a stop opens (a React
  // descendant of the nav) keep their own Enter, Space and typing.
  const stopIndexOf = (target: EventTarget) =>
    stops.findIndex((s) => itemRefs.current[s.id] === target);

  // The sheet's dialog stops the arrow keys at its popup (Base UI), so it hands them here itself;
  // the keys it lets through also bubble to the nav, and each press is handled once.
  const keysHandled = useRef(new WeakSet<Event>());
  const onNavKeyDown = (e: React.KeyboardEvent) => {
    if (keysHandled.current.has(e.nativeEvent) || stopIndexOf(e.target) < 0) return;
    keysHandled.current.add(e.nativeEvent);
    handleKeyDown(e);
  };

  // Focus can land on a stop without the roving index moving (a click, Tab after a
  // cancelled confirm). Enter and Space act on the roving index, so keep it on the
  // focused stop, and keep that stop visible inside the scrolling area.
  const navRef = useRef<HTMLElement | null>(null);
  const focusInside = useRef(false);
  // The last rail row that had focus, and whether the rail had it when the window lost focus.
  const lastRailId = useRef<string | null>(null);
  const insideAtWindowBlur = useRef(false);
  const onNavFocus = (e: React.FocusEvent) => {
    focusInside.current = true;
    const i = stopIndexOf(e.target);
    if (i < 0) return;
    lastRailId.current = stops[i].id;
    if (i !== activeIndex) setActiveIndex(i);
    const focusedRow = rows[i];
    setRoving((prev) => ({
      tab: activeTab,
      id: stops[i].id,
      panelId: focusedRow?.column === "panel" ? stops[i].id : prev.panelId,
    }));
    (e.target as HTMLElement).scrollIntoView?.({ block: "nearest" });
  };
  const onNavBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget;
    if (to instanceof Node) {
      if (!navRef.current?.contains(to)) focusInside.current = false;
      return;
    }
    // No relatedTarget: either the row was removed or hidden (focus is still ours to restore) or
    // focus really left the page content (the browser chrome). A row that is still shown means it left.
    const from = e.target as Element;
    if (from.isConnected && from.closest("[hidden]") === null) focusInside.current = false;
  };
  useEffect(() => {
    // A press outside the rail ends "focus was in the rail"; removal of a focused row does not blur.
    const onPress = (e: Event) => {
      if (e.target instanceof Node && !navRef.current?.contains(e.target)) {
        focusInside.current = false;
        // A click that brings the window back is not a way into the rail either.
        insideAtWindowBlur.current = false;
      }
    };
    // The window losing focus is not a way back into the rail either.
    // The row's own blur (no relatedTarget) arrives before this one and already cleared
    // `focusInside`, so read where focus is from the document: it stays on the row while the
    // window is away.
    const onWindowBlur = () => {
      const active = document.activeElement;
      const inside = !!active && active !== document.body && !!navRef.current?.contains(active);
      insideAtWindowBlur.current = inside;
      if (inside) lastRailId.current = active.getAttribute("data-nav-id") ?? lastRailId.current;
      focusInside.current = false;
    };
    // Back from another window: if the rail had focus when it left and its row was removed
    // meanwhile, focus is on <body>; put it on the nearest row. Focus that is anywhere else
    // (or was outside the rail to begin with) is never taken.
    const onWindowFocus = () => {
      if (!insideAtWindowBlur.current) return;
      insideAtWindowBlur.current = false;
      const active = document.activeElement;
      if (active && active !== document.body) {
        focusInside.current = !!navRef.current?.contains(active);
        return;
      }
      const wanted = lastRailId.current && equivalentRowId(rowsRef.current, lastRailId.current);
      const el = (wanted && itemRefs.current[wanted]) || itemRefs.current[rowsRef.current[0]?.id ?? ""];
      el?.focus();
    };
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);

  // Whatever removes the focused row (a Tree/Split flip, the panel of another group after a
  // route change, a group hidden for an unemployed manager) leaves focus on <body>. When focus
  // was in the rail, put it back on the row with the same id, or its nearest equivalent, or the
  // first stop. Runs when the set of rows changes, never on an ordinary render.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const rowsKey = rows.map((r) => r.id).join("|");
  const prevRowsKey = useRef(rowsKey);
  useLayoutEffect(() => {
    if (prevRowsKey.current === rowsKey) return;
    prevRowsKey.current = rowsKey;
    const active = document.activeElement;
    // A collapsed Tree group hides its children (`hidden`) rather than removing them, and the
    // browser only drops their focus a frame later, so a hidden focused row counts as lost too.
    const lost =
      !active ||
      active === document.body ||
      !navRef.current?.contains(active) ||
      active.closest("[hidden]") !== null;
    if (!focusInside.current || !lost) return;
    (itemRefs.current[currentRowId] ?? itemRefs.current[stops[0]?.id ?? ""])?.focus();
  }, [rowsKey, currentRowId, stops]);

  // Fade cues that only show while the stops area has more content past an edge.
  const fade = useFadeMask<HTMLDivElement>(`${stops.length}-${tree}`);

  const indexOf = (id: string) => stops.findIndex((s) => s.id === id);
  // R15: in Split (and on Android) the rail and its docked panel are two roving widgets, one
  // Tab stop each. Tab order: the rail's current stop, the panel's current row, then the content.
  // Tree keeps one stop: its children are rows of the same widget.
  const panelRows = rows.filter((r) => r.column === "panel");
  const inPanel = panelRows.some((r) => r.id === currentRowId);
  const railTabId = inPanel && panelGroup ? `group:${panelGroup.id}` : currentRowId;
  const panelTabId = inPanel
    ? currentRowId
    : (panelRows.find((r) => r.id === roving.panelId) ??
        panelRows.find((r) => r.active) ??
        panelRows[0])?.id;
  const twoStops = !tree && panelRows.length > 0;
  const itemProps = (id: string): { tabIndex: 0 | -1; buttonRef: (el: HTMLButtonElement | null) => void } => ({
    tabIndex: twoStops ? (id === railTabId || id === panelTabId ? 0 : -1) : getTabIndex(indexOf(id)),
    buttonRef: (el: HTMLButtonElement | null) => {
      itemRefs.current[id] = el;
    },
  });

  // R13: icon-only stops when the labelled ones would not fit the height, so the rail never
  // scrolls its stops. The widest label (1 or 2 lines) is measured on a hidden measurer, not on
  // the stops, so it also works while the stops are icon-only and a language or font change
  // cannot leave a stale line count. It runs only when what it reads changes.
  const [labelMode, setLabelMode] = useState<"labels" | "icons">("labels");
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    let live = true;
    const tick = () => live && setFontsTick((n) => n + 1);
    void document.fonts?.ready?.then(tick);
    // A font that loads after the first `ready` (a lazily used weight) widens the labels too.
    document.fonts?.addEventListener?.("loadingdone", tick);
    return () => {
      live = false;
      document.fonts?.removeEventListener?.("loadingdone", tick);
    };
  }, []);
  const measurerRef = useRef<HTMLDivElement | null>(null);
  const measureLabels = !tree && !compact && !android && !!railSlot?.rootPx;
  const stopCount = RAIL_DIRECT.length + groups.length;
  const stopLabels = [...RAIL_DIRECT, ...groups].map((item) =>
    t(item.labelKey, { defaultValue: item.defaultLabel }),
  );
  const labelsKey = stopLabels.join("|");
  const language = i18n?.language;
  const slotH = railSlot?.slotH ?? 0;
  const rootPx = railSlot?.rootPx ?? 0;
  useLayoutEffect(() => {
    if (!measureLabels) return;
    let widest = 1;
    for (const el of measurerRef.current?.querySelectorAll<HTMLElement>("span") ?? []) {
      const line = parseFloat(getComputedStyle(el).lineHeight) || rootPx;
      widest = Math.max(widest, Math.round(el.getBoundingClientRect().height / line) || 1);
    }
    const next = splitLabelsFit({
      slotH,
      rootPx,
      labelLines: Math.min(widest, 2),
      stops: stopCount,
      current: labelMode,
    });
    if (next !== labelMode) setLabelMode(next);
  }, [measureLabels, slotH, rootPx, labelsKey, language, fontsTick, labelMode, stopCount]);
  const iconOnlyStops = !tree && !compact && !android && !!railSlot?.rootPx && labelMode === "icons";

  // The sheet keeps its group's content while it closes.
  const lastSheet = useRef<typeof panelGroup>(null);
  if (android && panelGroup) lastSheet.current = panelGroup;
  const sheetShown = panelGroup ?? lastSheet.current;
  const landingTab = sheetShown
    ? groupForTab(activeTab) === sheetShown.id
      ? activeTab
      : resolveGroupLanding(sheetShown.id, lastVisited)
    : "";
  const labelOf = (item: { labelKey: string; defaultLabel: string }) =>
    t(item.labelKey, { defaultValue: item.defaultLabel });
  const listLabel = (group: string) => t("onAir.nav.sections", { group, defaultValue: "{{group}} sections" });
  const attentionName = (label: string, count: number) =>
    t("onAir.nav.needsCall", {
      label,
      count,
      defaultValue_one: "{{label}}, needs your call",
      defaultValue_other: "{{label}}, {{count}} need your call",
    });
  const managerLabel = t("onAir.nav.manager", { defaultValue: "Manager profile" });
  const initials = Array.from((managerName ?? "").trim()).slice(0, 2).join("").toUpperCase();

  const scroller = (children: React.ReactNode) => (
    <div
      ref={fade.ref}
      data-slot="rail-stops"
      data-overflow-top={fade["data-overflow-top"]}
      data-overflow-bottom={fade["data-overflow-bottom"]}
      onScroll={fade.onScroll}
      style={fade.style}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </div>
  );

  // The palette returns focus to Go by its id (util:go) when it closes by Escape, Close or Back.
  const go = (variant: "row" | "cell" | "stop") => (
    <GoButton variant={variant} onClick={() => openPalette(GO_ID)} {...itemProps(GO_ID)} />
  );
  const cluster = (
    <RailCluster stacked={!tree}>
      <FloatingBugButton
        variant="cell"
        open={bugOpen}
        onOpenChange={setBugOpen}
        data-nav-id="util:bug"
        {...itemProps("util:bug")}
      />
      <RailCell
        navId="util:settings"
        icon={Settings}
        label={t("dashboard.settings", { defaultValue: "Settings" })}
        onClick={onNavigateSettings}
        {...itemProps("util:settings")}
      />
      <RailCell
        navId="util:exit"
        icon={LogOut}
        tone="danger"
        label={t("dashboard.exitToMenu", { defaultValue: "Exit" })}
        onClick={onExitClick}
        {...itemProps("util:exit")}
      />
      <RailCell
        navId="util:manager"
        label={managerName ? `${managerLabel}, ${managerName}` : managerLabel}
        tip={managerFullName ?? managerName ?? managerLabel}
        current={activeTab === "Manager"}
        onClick={() => onNavClick("Manager")}
        {...itemProps("util:manager")}
      >
        {managerAvatar ? (
          <img
            src={managerAvatar}
            alt=""
            className={cn(
              "size-7 rounded-full object-cover ring-2",
              activeTab === "Manager"
                ? "ring-[3px] ring-club-text forced-colors:outline-2 forced-colors:outline-solid forced-colors:outline-[Highlight]"
                : "ring-line",
            )}
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "flex size-7 items-center justify-center rounded-full bg-muted font-heading text-nav font-bold text-foreground ring-2",
              activeTab === "Manager"
                ? "ring-[3px] ring-club-text forced-colors:outline-2 forced-colors:outline-solid forced-colors:outline-[Highlight]"
                : "ring-line",
            )}
          >
            {initials}
          </span>
        )}
      </RailCell>
    </RailCluster>
  );

  return (
    <div
      data-slot="rail"
      data-rail-mode={tree ? "tree" : "split"}
      data-rail-slot-w={railSlot?.slotW}
      data-rail-slot-h={railSlot?.slotH}
      data-rail-need={railSlot?.need}
      className={cn(
        "relative flex h-full min-h-0 shrink-0 border-e border-line bg-rail text-sidebar-foreground",
        tree && "w-[var(--rail-w-tree)]",
      )}
    >
      {measureLabels && (
        <div
          ref={measurerRef}
          data-slot="rail-measurer"
          aria-hidden="true"
          style={{ width: `calc(var(--rail-w-split) - ${RAIL_STOP_INSET_REM}rem)` }}
          className="pointer-events-none invisible absolute -z-10"
        >
          {stopLabels.map((label, i) => (
            <span
              key={i}
              className={cn(RAIL_LABEL_CLASS, "block font-bold")}
            >
              {label}
            </span>
          ))}
        </div>
      )}
      <nav
        ref={navRef}
        aria-label={t("onAir.nav.rail", { defaultValue: "Main navigation" })}
        className={cn("flex min-h-0 flex-1", tree && "flex-col")}
        onKeyDown={onNavKeyDown}
        onFocus={onNavFocus}
        onBlur={onNavBlur}
      >
        {tree ? (
          <>
            {go("row")}
            {scroller(
              <RailTree
                activeTab={activeTab}
                groups={groups}
                openGroups={openGroups}
                badges={badges}
                labelOf={labelOf}
                listLabel={listLabel}
                attention={attention}
                attentionName={attentionName}
                onNavClick={onNavClick}
                onToggleGroup={toggleGroup}
                handle={itemProps}
              />,
            )}
            {cluster}
          </>
        ) : (
          <>
            <div
              data-slot="rail-column"
              className={cn(
                "flex min-h-0 shrink-0 flex-col",
                android ? "w-[var(--rail-w-phone)]" : compact ? "w-[var(--rail-w-compact)]" : "w-[var(--rail-w-split)]",
              )}
            >
              {scroller(
                <RailSplitStops
                  activeTab={activeTab}
                  groups={groups}
                  badges={badges}
                  labelOf={labelOf}
                  compact={compact}
                  iconOnly={iconOnlyStops}
                  android={android}
                  leading={android ? go("stop") : <div className="px-[6px]">{go("cell")}</div>}
                  lastVisited={lastVisited}
                  onNavClick={onNavClick}
                  onGroup={android ? setSheetGroup : undefined}
                  openGroup={sheetGroup}
                  handle={itemProps}
                />,
              )}
              {!android && cluster}
            </div>
            {panelGroup && !android && (
              <RailSplitPanel
                group={panelGroup}
                activeTab={activeTab}
                badges={badges}
                labelOf={labelOf}
                listLabel={listLabel}
                attention={attention}
                attentionName={attentionName}
                onNavClick={onNavClick}
                handle={itemProps}
                touch={android}
              />
            )}
            {android && sheetShown && (
              <SideSheet
                open={panelGroup !== null}
                onClose={() => setSheetGroup(null)}
                title={labelOf(sheetShown)}
                closeLabel={t("onAir.palette.close", { defaultValue: "Close" })}
                alignToRail
                initialFocus={landingRef}
                returnFocus={() => itemRefs.current[`group:${sheetShown.id}`] ?? null}
                activateRef={sheetActivate}
                onActivated={(tab) => (onSheetNavigate ?? onNavClick)(tab as string)}
                onKeyDown={onNavKeyDown}
                platform="android"
                data-slot="group-sheet"
              >
                <RailSplitPanel
                  sheet
                  touch
                  group={sheetShown}
                  activeTab={activeTab}
                  badges={badges}
                  labelOf={labelOf}
                  listLabel={listLabel}
                  attention={attention}
                  attentionName={attentionName}
                  onNavClick={(tab) => sheetActivate.current?.(tab)}
                  // The section to land on: the open page's, else the one last used in the group.
                  handle={(id) => {
                    const h = itemProps(id);
                    return id !== `tab:${landingTab}`
                      ? h
                      : {
                          ...h,
                          buttonRef: (el) => {
                            h.buttonRef(el);
                            landingRef.current = el;
                          },
                        };
                  }}
                />
              </SideSheet>
            )}
          </>
        )}
      </nav>
    </div>
  );
}
