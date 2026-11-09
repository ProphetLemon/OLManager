import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Settings } from "lucide-react";

import { useRovingFocus } from "@/hooks/useRovingFocus";
import FloatingBugButton from "@/ui-v2/_legacy/components/dashboard/FloatingBugButton";
import { ClubShield } from "@/ui-v2/components/ui/club-shield";
import { RailItem } from "@/ui-v2/shell/RailItem";
import {
  RAIL_DIRECT,
  RAIL_GROUPS,
  groupForTab,
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
  teamName,
  teamLogo,
  isUnemployed,
  onNavigateSettings,
  onExitClick,
  playerCount = 0,
  teamCount = 0,
  staffCount = 0,
  compact = false,
}: Props) {
  const { t } = useTranslation();

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
  const lastVisited = useRef<Partial<Record<RailGroupId, string>>>({});
  useEffect(() => {
    const group = groupForTab(activeTab);
    if (group) lastVisited.current[group] = activeTab;
  }, [activeTab]);

  const groups = useMemo(
    () => RAIL_GROUPS.filter((g) => !(isUnemployed && g.hiddenWhenUnemployed)),
    [isUnemployed],
  );

  const stops: Stop[] = useMemo(
    () => [
      ...RAIL_DIRECT.map((item) => ({ id: item.tab, activate: () => onNavClick(item.tab) })),
      ...groups.map((g) => ({
        id: `group:${g.id}`,
        activate: () => onNavClick(resolveGroupLanding(g.id, lastVisited.current)),
      })),
      { id: "settings", activate: onNavigateSettings },
      { id: "exit", activate: onExitClick },
      { id: "Manager", activate: () => onNavClick("Manager") },
    ],
    [groups, onNavClick, onNavigateSettings, onExitClick],
  );

  const currentStopId = activeTab === "Manager" ? "Manager" : railStopForTab(activeTab);
  const controlledIndex = stops.findIndex((s) => s.id === currentStopId);

  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const { activeIndex, shouldFocus, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: stops.length,
    columns: 1,
    index: controlledIndex,
    focusOnMount: false,
    orientation: "vertical",
    onSelect: (i) => stopsRef.current[i]?.activate(),
    getItemLabel: (i) => itemRefs.current[stops[i]?.id ?? ""]?.title ?? "",
  });

  // Depends on the focus intent only: `stops` is rebuilt whenever the parent passes new
  // callbacks, and re-running on that would pull focus back into the rail.
  useEffect(() => {
    if (!shouldFocus || activeIndex < 0) return;
    itemRefs.current[stopsRef.current[activeIndex]?.id ?? ""]?.focus();
  }, [shouldFocus, activeIndex]);

  // Only keys pressed on a roving stop drive the widget. The bug button and its modal
  // (a React descendant of the nav) keep their own Enter, Space and typing.
  const onNavKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isStop = Object.values(itemRefs.current).some((el) => el === target);
    if (isStop) handleKeyDown(e);
  };

  const indexOf = (id: string) => stops.findIndex((s) => s.id === id);
  const itemProps = (id: string) => ({
    tabIndex: getTabIndex(indexOf(id)),
    buttonRef: (el: HTMLButtonElement | null) => {
      itemRefs.current[id] = el;
    },
  });

  const labelOf = (item: { labelKey: string; defaultLabel: string }) =>
    t(item.labelKey, { defaultValue: item.defaultLabel });
  const badgeOf = (item: NavItem) => (item.badge ? badges[item.badge] : undefined);

  const groupBadge = (id: RailGroupId) => (id === "market" ? badges.offers : undefined);
  const managerLabel = t("onAir.nav.manager", { defaultValue: "Manager profile" });
  const initials = Array.from((managerName ?? "").trim()).slice(0, 2).join("").toUpperCase();

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-e border-line bg-rail text-sidebar-foreground",
        compact ? "w-14" : "w-[4.75rem]",
      )}
    >
      <div className="flex shrink-0 justify-center py-3">
        <ClubShield name={teamName ?? ""} logoUrl={teamLogo} size="md" decorative />
      </div>

      <nav
        aria-label={t("onAir.nav.rail", { defaultValue: "Main navigation" })}
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={onNavKeyDown}
      >
        <div
          data-slot="rail-stops"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
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
              active={groupForTab(activeTab) === g.id}
              badge={groupBadge(g.id)}
              compact={compact}
              onClick={() => onNavClick(resolveGroupLanding(g.id, lastVisited.current))}
              {...itemProps(`group:${g.id}`)}
            />
          ))}
        </div>

        <div
          data-slot="rail-pinned"
          className="flex shrink-0 flex-col items-stretch border-t border-line py-1"
        >
          <div className="flex justify-center">
            <FloatingBugButton placement="rail" />
          </div>
          <RailItem
            icon={Settings}
            label={t("dashboard.settings", { defaultValue: "Settings" })}
            compact={compact}
            onClick={onNavigateSettings}
            {...itemProps("settings")}
          />
          <RailItem
            icon={LogOut}
            label={t("dashboard.exitToMenu", { defaultValue: "Exit" })}
            tone="danger"
            compact={compact}
            onClick={onExitClick}
            {...itemProps("exit")}
          />
          <button
            type="button"
            onClick={() => onNavClick("Manager")}
            aria-label={managerName ? `${managerLabel}, ${managerName}` : managerLabel}
            aria-current={activeTab === "Manager" ? "page" : undefined}
            title={managerFullName ?? managerName ?? managerLabel}
            {...{ tabIndex: getTabIndex(indexOf("Manager")) }}
            ref={(el) => {
              itemRefs.current.Manager = el;
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
