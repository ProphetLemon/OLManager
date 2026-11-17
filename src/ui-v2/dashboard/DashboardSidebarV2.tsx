import { useNavMemoryStore } from "@/store/navMemoryStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Settings } from "lucide-react";

import { useRovingFocus } from "@/hooks/useRovingFocus";
import FloatingBugButton from "@/ui-v2/_legacy/components/dashboard/FloatingBugButton";
import { RailItem } from "@/ui-v2/shell/RailItem";
import { RailTree } from "@/ui-v2/shell/RailTree";
import type { RailMode } from "@/ui-v2/shell/railMode";
import { treeKeyAction, type TreeRow } from "@/ui-v2/shell/treeRows";
import {
  RAIL_DIRECT,
  RAIL_GROUPS,
  groupForTab,
  isGroupOpen,
  railStopForTab,
  resolveGroupLanding,
  type NavItem,
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
  /** Tree shows the Club tree in the rail; anything else is today's icon rail. */
  railMode?: RailMode;
  /** Measurements behind `railMode`, exposed as data attributes for QA. */
  railSlot?: { slotW: number; slotH: number; need: number };
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
}: Props) {
  const { t } = useTranslation();
  // The end-of-season screen keeps the icon rail whatever the size says.
  const tree = railMode === "tree" && !compact;

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

  const openGroups = useNavMemoryStore((s) => s.openGroups);
  const toggleGroup = useNavMemoryStore((s) => s.toggleGroup);

  const groups = useMemo(
    () => RAIL_GROUPS.filter((g) => !(isUnemployed && g.hiddenWhenUnemployed)),
    [isUnemployed],
  );

  // Tree: the visible rows in DOM order, then the utility stops. Split: today's stops.
  const treeRows: TreeRow[] = useMemo(() => {
    if (!tree) return [];
    const rows: TreeRow[] = RAIL_DIRECT.map((i) => ({
      id: `tab:${i.tab}`,
      kind: "leaf" as const,
      level: 0 as const,
      parentId: null,
    }));
    for (const g of groups) {
      const open = isGroupOpen(openGroups, g.id);
      rows.push({ id: `group:${g.id}`, kind: "header", level: 0, parentId: null, expanded: open });
      if (open) {
        for (const i of g.items) {
          rows.push({ id: `tab:${i.tab}`, kind: "child", level: 1, parentId: `group:${g.id}` });
        }
      }
    }
    for (const u of ["settings", "exit", "manager"]) {
      rows.push({ id: `util:${u}`, kind: "utility", level: 0, parentId: null });
    }
    return rows;
  }, [tree, groups, openGroups]);

  const splitStops: Stop[] = useMemo(
    () => [
      ...RAIL_DIRECT.map((item) => ({ id: item.tab, activate: () => onNavClick(item.tab) })),
      ...groups.map((g) => ({
        id: `group:${g.id}`,
        activate: () => onNavClick(resolveGroupLanding(g.id, lastVisited)),
      })),
      { id: "settings", activate: onNavigateSettings },
      { id: "exit", activate: onExitClick },
      { id: "Manager", activate: () => onNavClick("Manager") },
    ],
    [groups, lastVisited, onNavClick, onNavigateSettings, onExitClick],
  );

  const stops: Stop[] = useMemo(
    () =>
      tree
        ? treeRows.map((r) => {
            const tab = r.id.startsWith("tab:") ? r.id.slice(4) : "";
            if (r.id.startsWith("group:")) {
              return { id: r.id, activate: () => toggleGroup(r.id.slice(6) as RailGroupId) };
            }
            if (r.id === "util:settings") return { id: r.id, activate: onNavigateSettings };
            if (r.id === "util:exit") return { id: r.id, activate: onExitClick };
            if (r.id === "util:manager") return { id: r.id, activate: () => onNavClick("Manager") };
            return { id: r.id, activate: () => onNavClick(tab) };
          })
        : splitStops,
    [tree, treeRows, splitStops, toggleGroup, onNavigateSettings, onExitClick, onNavClick],
  );
  // Tree: the row the user last moved to wins until the active tab changes; else the
  // active tab's row (its header while the group is collapsed).
  const [roving, setRoving] = useState<{ tab: string; id: string | null }>({ tab: activeTab, id: null });
  if (roving.tab !== activeTab) setRoving({ tab: activeTab, id: null });
  const treeActiveId = (() => {
    if (activeTab === "Manager") return "util:manager";
    const g = groupForTab(activeTab);
    if (g && !isGroupOpen(openGroups, g)) return `group:${g}`;
    return `tab:${activeTab}`;
  })();
  const treeCurrentId =
    roving.id && stops.some((s) => s.id === roving.id) ? roving.id : treeActiveId;

  const currentStopId = tree
    ? treeCurrentId
    : activeTab === "Manager"
      ? "Manager"
      : railStopForTab(activeTab);
  const controlledIndex = stops.findIndex((s) => s.id === currentStopId);

  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  // Tree keymap, kept in a ref because it needs `setActiveIndex` from the hook it feeds.
  const treeKeyRef = useRef<(e: React.KeyboardEvent, i: number) => boolean>(() => false);
  const { activeIndex, shouldFocus, setActiveIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: stops.length,
    columns: 1,
    index: controlledIndex,
    focusOnMount: false,
    orientation: "vertical",
    onSelect: (i) => stopsRef.current[i]?.activate(),
    getItemLabel: (i) => itemRefs.current[stops[i]?.id ?? ""]?.title ?? "",
    onKey: (e, i) => treeKeyRef.current(e, i),
  });

  treeKeyRef.current = (e, roving) => {
    if (!tree) return false;
    // The row that has focus is the one that acts, whatever the roving state says yet.
    const focused = stopIndexOf(e.target);
    const i = focused >= 0 ? focused : roving;
    // Browser and OS shortcuts (Alt+Left = back) are not ours: skip the roving default too.
    if (e.altKey || e.ctrlKey || e.metaKey) return true;
    const action = treeKeyAction(treeRows, i, e.key, "tree");
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

  // Only keys pressed on a roving stop drive the widget. The bug button and its modal
  // (a React descendant of the nav) keep their own Enter, Space and typing.
  const stopIndexOf = (target: EventTarget) =>
    stops.findIndex((s) => itemRefs.current[s.id] === target);

  const onNavKeyDown = (e: React.KeyboardEvent) => {
    if (stopIndexOf(e.target) >= 0) handleKeyDown(e);
  };

  // Focus can land on a stop without the roving index moving (a click, Tab after a
  // cancelled confirm). Enter and Space act on the roving index, so keep it on the
  // focused stop, and keep that stop visible inside the scrolling area.
  const onNavFocus = (e: React.FocusEvent) => {
    const i = stopIndexOf(e.target);
    if (i < 0) return;
    if (i !== activeIndex) setActiveIndex(i);
    if (tree) setRoving({ tab: activeTab, id: stops[i].id });
    (e.target as HTMLElement).scrollIntoView?.({ block: "nearest" });
  };

  // Fade cues that only show while the stops area has more content past an edge.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
    setOverflow((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);
  useEffect(() => {
    measure();
    const el = scrollerRef.current;
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (el) observer?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure, stops.length]);
  const fadeMask = `linear-gradient(to bottom, ${overflow.top ? "transparent 0, #000 1.5rem" : "#000 0"}, ${
    overflow.bottom ? "#000 calc(100% - 1.5rem), transparent 100%" : "#000 100%"
  })`;

  const indexOf = (id: string) => stops.findIndex((s) => s.id === id);
  const itemProps = (id: string): { tabIndex: 0 | -1; buttonRef: (el: HTMLButtonElement | null) => void } => ({
    tabIndex: getTabIndex(indexOf(id)),
    buttonRef: (el: HTMLButtonElement | null) => {
      itemRefs.current[id] = el;
    },
  });

  const labelOf = (item: { labelKey: string; defaultLabel: string }) =>
    t(item.labelKey, { defaultValue: item.defaultLabel });
  const badgeOf = (item: NavItem) => (item.badge ? badges[item.badge] : undefined);

  const hintOf = (g: { items: { labelKey: string; defaultLabel: string }[] }) =>
    g.items.map(labelOf).join(", ");
  const groupBadge = (id: RailGroupId) => (id === "market" ? badges.offers : undefined);
  const managerLabel = t("onAir.nav.manager", { defaultValue: "Manager profile" });
  const initials = Array.from((managerName ?? "").trim()).slice(0, 2).join("").toUpperCase();

  return (
    <aside
      data-rail-mode={tree ? "tree" : "split"}
      data-rail-slot-w={railSlot?.slotW}
      data-rail-slot-h={railSlot?.slotH}
      data-rail-need={railSlot?.need}
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col border-e border-line bg-rail text-sidebar-foreground",
        tree ? "w-[var(--rail-w-tree)]" : compact ? "w-14" : "w-[4.75rem]",
      )}
    >
      <nav
        aria-label={t("onAir.nav.rail", { defaultValue: "Main navigation" })}
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={onNavKeyDown}
        onFocus={onNavFocus}
      >
        <div
          ref={scrollerRef}
          data-slot="rail-stops"
          data-overflow-top={overflow.top ? "true" : undefined}
          data-overflow-bottom={overflow.bottom ? "true" : undefined}
          onScroll={measure}
          style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tree ? (
            <RailTree
              activeTab={activeTab}
              groups={groups}
              openGroups={openGroups}
              badges={badges}
              labelOf={labelOf}
              listLabel={(group) =>
                t("onAir.nav.strip", { group, defaultValue: "{{group}} sections" })
              }
              onNavClick={onNavClick}
              onToggleGroup={toggleGroup}
              handle={itemProps}
            />
          ) : (
            <>
          {RAIL_DIRECT.map((item) => (
            <RailItem
              key={item.tab}
              icon={item.icon}
              label={labelOf(item)}
              active={activeTab === item.tab}
              badge={badgeOf(item)}
              compact={compact}
              onClick={() => onNavClick(item.tab)}
              {...itemProps(item.tab)}
            />
          ))}
          <div role="separator" className="mx-3 my-1.5 border-t border-line" />
          {groups.map((g) => (
            <RailItem
              key={g.id}
              icon={g.icon}
              label={labelOf(g)}
              hint={hintOf(g)}
              active={groupForTab(activeTab) === g.id}
              badge={groupBadge(g.id)}
              compact={compact}
              onClick={() => onNavClick(resolveGroupLanding(g.id, lastVisited))}
              {...itemProps(`group:${g.id}`)}
            />
          ))}
            </>
          )}
        </div>

        <div
          data-slot="rail-pinned"
          className="flex shrink-0 flex-col items-stretch border-t border-line py-1"
        >
          <div className="flex justify-center">
            <FloatingBugButton />
          </div>
          <RailItem
            icon={Settings}
            label={t("dashboard.settings", { defaultValue: "Settings" })}
            compact={compact}
            onClick={onNavigateSettings}
            data-nav-id="util:settings"
            {...itemProps(tree ? "util:settings" : "settings")}
          />
          <RailItem
            icon={LogOut}
            label={t("dashboard.exitToMenu", { defaultValue: "Exit" })}
            tone="danger"
            compact={compact}
            onClick={onExitClick}
            data-nav-id="util:exit"
            {...itemProps(tree ? "util:exit" : "exit")}
          />
          <button
            type="button"
            onClick={() => onNavClick("Manager")}
            aria-label={managerName ? `${managerLabel}, ${managerName}` : managerLabel}
            aria-current={activeTab === "Manager" ? "page" : undefined}
            title={managerFullName ?? managerName ?? managerLabel}
            data-nav-id="util:manager"
            {...{ tabIndex: getTabIndex(indexOf(tree ? "util:manager" : "Manager")) }}
            ref={(el) => {
              itemRefs.current[tree ? "util:manager" : "Manager"] = el;
            }}
            className="mx-auto my-1 flex size-[var(--hit)] items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            {managerAvatar ? (
              <img
                src={managerAvatar}
                alt=""
                className={cn(
                  "size-9 rounded-full object-cover ring-2",
                  activeTab === "Manager" ? "ring-[3px] ring-club-text" : "ring-line",
                )}
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-9 items-center justify-center rounded-full bg-muted font-heading text-xs font-bold text-foreground ring-2",
                  activeTab === "Manager" ? "ring-[3px] ring-club-text" : "ring-line",
                )}
              >
                {initials}
              </span>
            )}
          </button>
        </div>
      </nav>
    </aside>
  );
}
