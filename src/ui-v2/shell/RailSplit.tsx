import type { ReactNode } from "react";

import { RailItem } from "./RailItem";
import { cn } from "@/ui-v2/lib/utils";
import { RailRow } from "./RailRow";
import { RAIL_DIRECT, groupForTab, resolveGroupLanding, type NavItem, type RailGroup, type RailGroupId } from "./navModel";
import type { ShellBadges } from "./shellTypes";
import type { Attention, AttentionMap } from "./attention";
import { useFadeMask } from "./useFadeMask";

interface RowHandle {
  tabIndex: 0 | -1;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

type LabelOf = (item: { labelKey: string; defaultLabel: string }) => string;

interface StopsProps {
  activeTab: string;
  groups: RailGroup[];
  badges: ShellBadges;
  labelOf: LabelOf;
  /** Hides the visible labels (the end-of-season screen); names stay for assistive tech. */
  compact: boolean;
  /** R13: icon-only stops with an IconTip, when the labelled ones do not fit the height. */
  iconOnly?: boolean;
  lastVisited: Partial<Record<RailGroupId, string>>;
  /** Android: only Home, Inbox and Schedule are direct stops; the rest live in `trailing` (More). */
  android?: boolean;
  /** Rendered after the group launchers (Android's More stop). */
  trailing?: ReactNode;
  onNavClick: (tab: string) => void;
  handle: (navId: string) => RowHandle;
}

/**
 * The icon-over-label stops of the Split rail: the direct stops, then one launcher per group.
 * A launcher navigates to its group's last tab; the panel beside the rail lists the rest.
 */
export function RailSplitStops({ activeTab, groups, badges, labelOf, compact, iconOnly = false, lastVisited, android = false, trailing, onNavClick, handle }: StopsProps) {
  const badgeOf = (item: NavItem) => (item.badge ? badges[item.badge] : undefined);
  const hintOf = (g: RailGroup) => g.items.map(labelOf).join(", ");
  return (
    <>
      {RAIL_DIRECT.filter((item) => !android || ANDROID_DIRECT.includes(item.tab)).map((item) => (
        <RailItem
          key={item.tab}
          icon={item.icon}
          label={labelOf(item)}
          active={activeTab === item.tab}
          badge={badgeOf(item)}
          compact={compact}
          iconOnly={iconOnly}
          onClick={() => onNavClick(item.tab)}
          data-nav-id={`tab:${item.tab}`}
          {...handle(`tab:${item.tab}`)}
        />
      ))}
      {!android && <div role="separator" className="mx-3 my-1.5 border-t border-line" />}
      {groups.map((g) => (
        <RailItem
          key={g.id}
          icon={g.icon}
          label={labelOf(g)}
          hint={hintOf(g)}
          active={groupForTab(activeTab) === g.id}
          badge={g.id === "market" ? badges.offers : undefined}
          compact={compact}
          iconOnly={iconOnly}
          onClick={() => onNavClick(resolveGroupLanding(g.id, lastVisited))}
          data-nav-id={`group:${g.id}`}
          {...handle(`group:${g.id}`)}
        />
      ))}
      {trailing}
    </>
  );
}

/** The direct stops Android keeps; News and Social move into More. */
export const ANDROID_DIRECT = ["Home", "Inbox", "Schedule"];

interface PanelProps {
  group: RailGroup;
  activeTab: string;
  badges: ShellBadges;
  labelOf: LabelOf;
  /** "{{group}} sections" */
  listLabel: (groupLabel: string) => string;
  attention?: AttentionMap;
  attentionName?: (label: string, count: number) => string;
  onNavClick: (tab: string) => void;
  handle: (navId: string) => RowHandle;
  /** Touch (Android): `--hit` rows (ruling R1) and a header sized from `--nav-cell`. */
  touch?: boolean;
}

/**
 * The docked panel of the active group (Split): a labelled group inside the one nav, with the
 * group's name and size as its header and its tabs below. It replaces the section strip.
 */
export function RailSplitPanel({ group, activeTab, badges, labelOf, listLabel, attention = {}, attentionName, onNavClick, handle, touch = false }: PanelProps) {
  const label = labelOf(group);
  const fade = useFadeMask<HTMLUListElement>(group.id);
  const marker = (item: NavItem, itemLabel: string): { attention?: Attention; attentionName?: string } => {
    const a = attention[item.tab];
    return a && attentionName ? { attention: a, attentionName: attentionName(itemLabel, a.count) } : {};
  };
  return (
    <div
      role="group"
      aria-label={listLabel(label)}
      data-slot="rail-panel"
      className="flex min-h-0 w-[var(--nav-panel-w)] shrink-0 flex-col border-s border-line"
    >
      <div
        aria-hidden="true"
        className={cn(
          touch ? "h-[calc(var(--nav-cell)-8px)]" : "h-[var(--nav-row)]",
          "flex shrink-0 items-center justify-between gap-2 px-3 font-heading text-nav leading-4 font-bold uppercase text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular-nums">{group.items.length}</span>
      </div>
      <ul
        ref={fade.ref}
        data-slot="rail-panel-scroll"
        onScroll={fade.onScroll}
        style={fade.style}
        data-overflow-top={fade["data-overflow-top"]}
        data-overflow-bottom={fade["data-overflow-bottom"]}
        className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-[6px] pt-0 pb-[var(--safe-bottom)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {group.items.map((item) => (
          <li key={item.tab}>
            <RailRow
              kind="panel"
              tall={touch}
              navId={`tab:${item.tab}`}
              label={labelOf(item)}
              badge={item.badge ? badges[item.badge] : undefined}
              active={activeTab === item.tab}
              onClick={() => onNavClick(item.tab)}
              {...marker(item, labelOf(item))}
              {...handle(`tab:${item.tab}`)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
