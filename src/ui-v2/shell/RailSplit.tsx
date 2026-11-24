import type { ReactNode } from "react";

import { RailItem } from "./RailItem";
import { cn } from "@/ui-v2/lib/utils";
import { RailRow } from "./RailRow";
import { RAIL_DIRECT, groupForTab, resolveGroupLanding, type NavItem, type RailGroup, type RailGroupId } from "./navModel";
import type { ShellBadges } from "./shellTypes";
import type { Attention, AttentionMap } from "./attention";
import { withBadge } from "./railActive";
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
  /** Rendered before the direct stops: Go, a cell on desktop and a stop on Android (spec section 7.1). */
  leading?: ReactNode;
  /** Rendered after the group launchers (Android's More stop). */
  trailing?: ReactNode;
  onNavClick: (tab: string) => void;
  /** Phone: a group stop opens its sections (in a sheet) instead of navigating; `openGroup` is the one that is open. */
  onGroup?: (id: RailGroupId) => void;
  openGroup?: RailGroupId | null;
  handle: (navId: string) => RowHandle;
}

/**
 * The icon-over-label stops of the Split rail: the direct stops, then one launcher per group.
 * A launcher navigates to its group's last tab; the panel beside the rail lists the rest.
 */
export function RailSplitStops({ activeTab, groups, badges, labelOf, compact, iconOnly = false, lastVisited, android = false, leading, trailing, onNavClick, onGroup, openGroup, handle }: StopsProps) {
  const badgeOf = (item: NavItem) => (item.badge ? badges[item.badge] : undefined);
  const hintOf = (g: RailGroup) => g.items.map(labelOf).join(", ");
  const stop = (item: NavItem) => (
    <li key={item.tab}>
      <RailItem
        icon={item.icon}
        label={labelOf(item)}
        active={activeTab === item.tab}
        badge={badgeOf(item)}
        compact={compact}
        iconOnly={iconOnly}
        phone={android}
        onClick={() => onNavClick(item.tab)}
        data-nav-id={`tab:${item.tab}`}
        {...handle(`tab:${item.tab}`)}
      />
    </li>
  );
  return (
    <ul className="m-0 list-none p-0">
      {leading && <li>{leading}</li>}
      {RAIL_DIRECT.filter((item) => !android || ANDROID_DIRECT.includes(item.tab)).map(stop)}
      {!android && (
        <li role="presentation" className="mx-3 my-1.5">
          <hr className="m-0 border-0 border-t border-line" />
        </li>
      )}
      {groups.map((g) => (
        <li key={g.id}>
          <RailItem
            icon={g.icon}
            label={labelOf(g)}
            hint={hintOf(g)}
            active={groupForTab(activeTab) === g.id}
            badge={g.id === "market" ? badges.offers : undefined}
            compact={compact}
            iconOnly={iconOnly}
            phone={android}
            aria-haspopup={onGroup ? "dialog" : undefined}
            aria-expanded={onGroup ? openGroup === g.id : undefined}
            onClick={() => (onGroup ? onGroup(g.id) : onNavClick(resolveGroupLanding(g.id, lastVisited)))}
            data-nav-id={`group:${g.id}`}
            {...handle(`group:${g.id}`)}
          />
        </li>
      ))}
      {trailing && <li>{trailing}</li>}
    </ul>
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
  /** Inside a side sheet: the sheet's title names the group, so no header; the rows fill the sheet in up to two columns. */
  sheet?: boolean;
}

/**
 * The docked panel of the active group (Split): a labelled group inside the one nav, with the
 * group's name and size as its header and its tabs below. It is the rail's second level in Split.
 */
export function RailSplitPanel({ group, activeTab, badges, labelOf, listLabel, attention = {}, attentionName, onNavClick, handle, touch = false, sheet = false }: PanelProps) {
  const label = labelOf(group);
  const fade = useFadeMask<HTMLUListElement>(group.id);
  // A sheet fills a column before it starts the next: one column up to five sections, else two.
  const rows = group.items.length > 5 ? Math.ceil(group.items.length / 2) : group.items.length;
  const marker = (item: NavItem, itemLabel: string): { attention?: Attention; attentionName?: string } => {
    const a = attention[item.tab];
    return a && attentionName
      ? { attention: a, attentionName: attentionName(withBadge(itemLabel, item.badge ? badges[item.badge] : undefined), a.count) }
      : {};
  };
  return (
    <div
      role="group"
      aria-label={listLabel(label)}
      data-slot="rail-panel"
      className={cn("flex min-h-0 flex-col", sheet ? "flex-1" : "w-[var(--nav-panel-w)] shrink-0 border-s border-line")}
    >
      {!sheet && <div
        aria-hidden="true"
        className={cn(
          touch ? "h-[calc(var(--nav-cell)-8px)]" : "h-[var(--nav-row)]",
          "flex shrink-0 items-center justify-between gap-2 px-3 font-heading text-nav leading-4 font-bold uppercase text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular-nums">{group.items.length}</span>
      </div>}
      <ul
        ref={fade.ref}
        data-slot="rail-panel-scroll"
        onScroll={fade.onScroll}
        style={sheet ? { ...fade.style, gridTemplateRows: `repeat(${rows}, minmax(0, auto))` } : fade.style}
        data-overflow-top={fade["data-overflow-top"]}
        data-overflow-bottom={fade["data-overflow-bottom"]}
        className={cn(
          "m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-[6px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          sheet ? "grid grid-flow-col auto-cols-fr content-start gap-1" : "pt-0 pb-[var(--safe-bottom)]",
        )}
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
