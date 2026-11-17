import { useId } from "react";

import type { RailGroup, RailGroupId } from "./navModel";
import { RailRow } from "./RailRow";
import { RAIL_DIRECT, groupForTab, isGroupOpen, type NavItem } from "./navModel";
import type { ShellBadges } from "./shellTypes";

interface RowHandle {
  tabIndex: 0 | -1;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

interface RailTreeProps {
  activeTab: string;
  groups: RailGroup[];
  openGroups: Partial<Record<RailGroupId, boolean>>;
  badges: ShellBadges;
  labelOf: (item: { labelKey: string; defaultLabel: string }) => string;
  /** Accessible name of a group's children list ("{{group}} sections"). */
  listLabel: (groupLabel: string) => string;
  onNavClick: (tab: string) => void;
  onToggleGroup: (id: RailGroupId) => void;
  /** Roving tab stop and ref for the row with this id. */
  handle: (navId: string) => RowHandle;
}

const groupBadgeOf = (id: RailGroupId, badges: ShellBadges) =>
  id === "market" ? badges.offers : undefined;

/** The rail's rows as nested lists: direct stops, a divider, then one disclosure per group. */
export function RailTree({
  activeTab,
  groups,
  openGroups,
  badges,
  labelOf,
  listLabel,
  onNavClick,
  onToggleGroup,
  handle,
}: RailTreeProps) {
  const baseId = useId();
  const badgeOf = (item: NavItem) => (item.badge ? badges[item.badge] : undefined);
  const owner = groupForTab(activeTab);

  return (
    <ul className="m-0 list-none p-1.5">
      {RAIL_DIRECT.map((item) => (
        <li key={item.tab}>
          <RailRow
            kind="leaf"
            navId={`tab:${item.tab}`}
            icon={item.icon}
            label={labelOf(item)}
            badge={badgeOf(item)}
            active={activeTab === item.tab}
            onClick={() => onNavClick(item.tab)}
            {...handle(`tab:${item.tab}`)}
          />
        </li>
      ))}
      <li role="separator" className="mx-1.5 my-2 border-t border-line" />
      {groups.map((g) => {
        const open = isGroupOpen(openGroups, g.id);
        const listId = `${baseId}-${g.id}`;
        const label = labelOf(g);
        return (
          <li key={g.id} className={g.id === "market" ? "mt-1" : undefined}>
            <RailRow
              kind="header"
              navId={`group:${g.id}`}
              icon={g.icon}
              label={label}
              badge={open ? undefined : groupBadgeOf(g.id, badges)}
              activeWithin={owner === g.id}
              expanded={open}
              controls={listId}
              onClick={() => onToggleGroup(g.id)}
              {...handle(`group:${g.id}`)}
            />
            <ul id={listId} aria-label={listLabel(label)} hidden={!open} className="m-0 list-none p-0">
              {g.items.map((item) => (
                <li key={item.tab}>
                  <RailRow
                    kind="child"
                    navId={`tab:${item.tab}`}
                    label={labelOf(item)}
                    badge={badgeOf(item)}
                    active={activeTab === item.tab}
                    onClick={() => onNavClick(item.tab)}
                    {...handle(`tab:${item.tab}`)}
                  />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
