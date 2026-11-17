import { useNavMemoryStore } from "@/store/navMemoryStore";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bug, LogOut, Newspaper, MessageCircle, Settings, UserRound } from "lucide-react";

import { useRovingFocus } from "@/hooks/useRovingFocus";
import FloatingBugButton from "@/ui-v2/_legacy/components/dashboard/FloatingBugButton";
import { ANDROID_DIRECT, RailSplitPanel, RailSplitStops } from "@/ui-v2/shell/RailSplit";
import { RailMore } from "@/ui-v2/shell/RailMore";
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
}: Props) {
  const { t } = useTranslation();
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
  const [moreOpen, setMoreOpen] = useState(false);
  const openGroups = useNavMemoryStore((s) => s.openGroups);
  const toggleGroup = useNavMemoryStore((s) => s.toggleGroup);

  const groups = useMemo(
    () => RAIL_GROUPS.filter((g) => !(isUnemployed && g.hiddenWhenUnemployed)),
    [isUnemployed],
  );

  const panelGroup = useMemo(() => {
    if (tree || compact) return null;
    const id = groupForTab(activeTab);
    return groups.find((g) => g.id === id) ?? null;
  }, [tree, compact, activeTab, groups]);

  // The visible rows in DOM order, with ids that mean the same in both modes
  // (`tab:Squad`, `group:club`, `util:settings`) so focus can follow a flip.
  const rows: TreeRow[] = useMemo(() => {
    const out: TreeRow[] = [];
    const rail = tree ? undefined : ("rail" as const);
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
    // Android keeps the utilities in the More menu: one stop instead of the four cells.
    for (const u of android ? ["more"] : ["bug", "settings", "exit", "manager"]) {
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
            activate: tree ? () => toggleGroup(id) : () => onNavClick(resolveGroupLanding(id, lastVisited)),
          };
        }
        if (r.id === "util:more") return { id: r.id, activate: () => setMoreOpen(true) };
        if (r.id === "util:bug") return { id: r.id, activate: () => setBugOpen(true) };
        if (r.id === "util:settings") return { id: r.id, activate: onNavigateSettings };
        if (r.id === "util:exit") return { id: r.id, activate: onExitClick };
        if (r.id === "util:manager") return { id: r.id, activate: () => onNavClick("Manager") };
        return { id: r.id, activate: () => onNavClick(r.id.slice("tab:".length)) };
      }),
    [rows, tree, toggleGroup, lastVisited, onNavClick, onNavigateSettings, onExitClick],
  );

  // The row the user last moved to wins until the active tab changes; else the active tab's
  // row: its header while a Tree group is collapsed, its launcher in Split.
  const [roving, setRoving] = useState<{ tab: string; id: string | null }>({ tab: activeTab, id: null });
  if (roving.tab !== activeTab) setRoving({ tab: activeTab, id: null });
  const activeRowId = (() => {
    if (activeTab === "Manager") return android ? "util:more" : "util:manager";
    if (android && (activeTab === "News" || activeTab === "Social")) return "util:more";
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
      return el?.title || el?.getAttribute("aria-label") || "";
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

  const onNavKeyDown = (e: React.KeyboardEvent) => {
    if (stopIndexOf(e.target) >= 0) handleKeyDown(e);
  };

  // Focus can land on a stop without the roving index moving (a click, Tab after a
  // cancelled confirm). Enter and Space act on the roving index, so keep it on the
  // focused stop, and keep that stop visible inside the scrolling area.
  const navRef = useRef<HTMLElement | null>(null);
  const focusInside = useRef(false);
  const onNavFocus = (e: React.FocusEvent) => {
    focusInside.current = true;
    const i = stopIndexOf(e.target);
    if (i < 0) return;
    if (i !== activeIndex) setActiveIndex(i);
    setRoving({ tab: activeTab, id: stops[i].id });
    (e.target as HTMLElement).scrollIntoView?.({ block: "nearest" });
  };
  const onNavBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget;
    if (to instanceof Node && !navRef.current?.contains(to)) focusInside.current = false;
  };
  useEffect(() => {
    // A press outside the rail ends "focus was in the rail"; removal of a focused row does not blur.
    const onPress = (e: Event) => {
      if (e.target instanceof Node && !navRef.current?.contains(e.target)) focusInside.current = false;
    };
    // The window losing focus is not a way back into the rail either.
    const onWindowBlur = () => {
      focusInside.current = false;
    };
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  // Whatever removes the focused row (a Tree/Split flip, the panel of another group after a
  // route change, a group hidden for an unemployed manager) leaves focus on <body>. When focus
  // was in the rail, put it back on the row with the same id, or its nearest equivalent, or the
  // first stop. Runs when the set of rows changes, never on an ordinary render.
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
  const itemProps = (id: string): { tabIndex: 0 | -1; buttonRef: (el: HTMLButtonElement | null) => void } => ({
    tabIndex: getTabIndex(indexOf(id)),
    buttonRef: (el: HTMLButtonElement | null) => {
      itemRefs.current[id] = el;
    },
  });

  // R13: icon-only stops when the labelled ones would not fit the height, so the rail never
  // scrolls its stops. The widest label (1 or 2 lines) is measured while labels are shown.
  const [labelMode, setLabelMode] = useState<"labels" | "icons">("labels");
  const [labelLines, setLabelLines] = useState(1);
  useLayoutEffect(() => {
    if (tree || compact || android || !railSlot?.rootPx) return;
    let lines = labelLines;
    if (labelMode === "labels") {
      let widest = 1;
      for (const el of navRef.current?.querySelectorAll<HTMLElement>('[data-slot="rail-item-label"]') ?? []) {
        const line = parseFloat(getComputedStyle(el).lineHeight) || railSlot.rootPx;
        widest = Math.max(widest, Math.round(el.getBoundingClientRect().height / line) || 1);
      }
      lines = Math.min(widest, 2);
    }
    const next = splitLabelsFit({
      slotH: railSlot.slotH,
      rootPx: railSlot.rootPx,
      labelLines: lines,
      stops: RAIL_DIRECT.length + groups.length,
      current: labelMode,
    });
    if (lines !== labelLines) setLabelLines(lines);
    if (next !== labelMode) setLabelMode(next);
  });
  const iconOnlyStops = !tree && !compact && !android && !!railSlot?.rootPx && labelMode === "icons";

  const labelOf = (item: { labelKey: string; defaultLabel: string }) =>
    t(item.labelKey, { defaultValue: item.defaultLabel });
  const listLabel = (group: string) => t("onAir.nav.strip", { group, defaultValue: "{{group}} sections" });
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

  const bugLabel = t("onAir.nav.bug", { defaultValue: "Report bug" });
  const moreItems = [
    { id: "news", label: labelOf({ labelKey: "dashboard.news", defaultLabel: "News" }), icon: Newspaper, onSelect: () => onNavClick("News") },
    { id: "social", label: labelOf({ labelKey: "dashboard.social", defaultLabel: "Social" }), icon: MessageCircle, onSelect: () => onNavClick("Social") },
    { id: "settings", label: t("dashboard.settings", { defaultValue: "Settings" }), icon: Settings, onSelect: onNavigateSettings },
    { id: "bug", label: bugLabel, icon: Bug, onSelect: () => setBugOpen(true) },
    { id: "exit", label: t("dashboard.exitToMenu", { defaultValue: "Exit" }), icon: LogOut, tone: "danger" as const, onSelect: onExitClick },
    { id: "manager", label: managerLabel, icon: UserRound, onSelect: () => onNavClick("Manager") },
  ];
  const more = (
    <RailMore
      label={t("onAir.nav.more", { defaultValue: "More" })}
      items={moreItems}
      open={moreOpen}
      onOpenChange={setMoreOpen}
      active={activeTab === "Manager" || activeTab === "News" || activeTab === "Social"}
      data-nav-id="util:more"
      {...itemProps("util:more")}
    />
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
              activeTab === "Manager" ? "ring-[3px] ring-club-text" : "ring-line",
            )}
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "flex size-7 items-center justify-center rounded-full bg-muted font-heading text-nav font-bold text-foreground ring-2",
              activeTab === "Manager" ? "ring-[3px] ring-club-text" : "ring-line",
            )}
          >
            {initials}
          </span>
        )}
      </RailCell>
    </RailCluster>
  );

  return (
    <aside
      data-rail-mode={tree ? "tree" : "split"}
      data-rail-slot-w={railSlot?.slotW}
      data-rail-slot-h={railSlot?.slotH}
      data-rail-need={railSlot?.need}
      className={cn(
        "flex h-full min-h-0 shrink-0 border-e border-line bg-rail text-sidebar-foreground",
        tree && "w-[var(--rail-w-tree)]",
      )}
    >
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
                android && "py-[8px]",
                compact ? "w-[var(--rail-w-compact)]" : "w-[var(--rail-w-split)]",
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
                  trailing={android ? more : undefined}
                  lastVisited={lastVisited}
                  onNavClick={onNavClick}
                  handle={itemProps}
                />,
              )}
              {android ? (
                <FloatingBugButton variant="hidden" open={bugOpen} onOpenChange={setBugOpen} />
              ) : (
                cluster
              )}
            </div>
            {panelGroup && (
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
          </>
        )}
      </nav>
    </aside>
  );
}
