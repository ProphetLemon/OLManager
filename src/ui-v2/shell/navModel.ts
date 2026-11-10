import {
  Briefcase,
  Building2,
  Calendar as CalendarIcon,
  Crosshair,
  DollarSign,
  Dumbbell,
  Eye,
  Gamepad2,
  Globe,
  GraduationCap,
  Mail,
  MessageCircle,
  Newspaper,
  Store,
  Swords,
  TrendingUp,
  Trophy,
  UserCog,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type RailGroupId = "club" | "market" | "world";

export interface NavItem {
  tab: string;
  labelKey: string;
  defaultLabel: string;
  icon: LucideIcon;
  badge?: "unread" | "offers" | "players" | "teams" | "staff";
}

export interface RailGroup {
  id: RailGroupId;
  labelKey: string;
  defaultLabel: string;
  icon: LucideIcon;
  items: NavItem[];
  hiddenWhenUnemployed?: boolean;
}

export const RAIL_DIRECT: NavItem[] = [
  { tab: "Home", labelKey: "dashboard.home", defaultLabel: "Home", icon: Briefcase },
  { tab: "Inbox", labelKey: "dashboard.inbox", defaultLabel: "Inbox", icon: Mail, badge: "unread" },
  { tab: "News", labelKey: "dashboard.news", defaultLabel: "News", icon: Newspaper },
  { tab: "Social", labelKey: "dashboard.social", defaultLabel: "Social", icon: MessageCircle },
  { tab: "Schedule", labelKey: "dashboard.schedule", defaultLabel: "Schedule", icon: CalendarIcon },
];

export const RAIL_GROUPS: RailGroup[] = [
  {
    id: "club",
    labelKey: "dashboard.sectionClub",
    defaultLabel: "Club",
    icon: Users,
    hiddenWhenUnemployed: true,
    items: [
      { tab: "Squad", labelKey: "dashboard.squad", defaultLabel: "Squad", icon: Users },
      { tab: "Tactics", labelKey: "dashboard.tactics", defaultLabel: "Tactics", icon: Crosshair },
      { tab: "Training", labelKey: "dashboard.training", defaultLabel: "Training", icon: Dumbbell },
      { tab: "Scrims", labelKey: "dashboard.scrims", defaultLabel: "Scrims", icon: Swords },
      { tab: "Soloq", labelKey: "dashboard.soloq", defaultLabel: "SoloQ", icon: Trophy },
      { tab: "Meta", labelKey: "dashboard.meta", defaultLabel: "Meta", icon: Gamepad2 },
      { tab: "Staff", labelKey: "dashboard.staff", defaultLabel: "Staff", icon: UserCog },
      { tab: "Scouting", labelKey: "dashboard.scouting", defaultLabel: "Scouting", icon: Eye },
      { tab: "Youth", labelKey: "dashboard.youthAcademy", defaultLabel: "Academy", icon: GraduationCap },
      { tab: "Finances", labelKey: "dashboard.finances", defaultLabel: "Finances", icon: DollarSign },
    ],
  },
  {
    id: "market",
    labelKey: "dashboard.sectionMarket",
    defaultLabel: "Market",
    icon: Store,
    items: [
      { tab: "Market", labelKey: "dashboard.market", defaultLabel: "Market", icon: Store },
      { tab: "Transfers", labelKey: "dashboard.transfers", defaultLabel: "Transfers", icon: TrendingUp, badge: "offers" },
    ],
  },
  {
    id: "world",
    labelKey: "dashboard.sectionWorld",
    defaultLabel: "World",
    icon: Globe,
    items: [
      { tab: "Competitions", labelKey: "dashboard.competitions", defaultLabel: "Competitions", icon: Globe },
      { tab: "Players", labelKey: "dashboard.players", defaultLabel: "Players", icon: UsersRound, badge: "players" },
      { tab: "Teams", labelKey: "dashboard.teams", defaultLabel: "Teams", icon: Building2, badge: "teams" },
      { tab: "WorldStaff", labelKey: "dashboard.worldStaff", defaultLabel: "Staffs", icon: UserCog, badge: "staff" },
      { tab: "ChampionsWorld", labelKey: "dashboard.champions_world", defaultLabel: "Champions", icon: Gamepad2 },
    ],
  },
];

/** Tab names the backend uses in a blocker that differ from the navigation ids. */
const BACKEND_TAB_ALIASES: Record<string, string> = { YouthAcademy: "Youth" };

/** The navigation tab a backend tab name (for example a blocker's `tab`) points to. */
export function resolveNavTab(tab: string): string {
  return BACKEND_TAB_ALIASES[tab] ?? tab;
}

/** The label the navigation shows for a tab, or null when the tab is not in the navigation. */
export function navLabelFor(tab: string): Pick<NavItem, "labelKey" | "defaultLabel"> | null {
  const resolved = resolveNavTab(tab);
  const item =
    RAIL_DIRECT.find((i) => i.tab === resolved) ??
    RAIL_GROUPS.flatMap((g) => g.items).find((i) => i.tab === resolved);
  return item ? { labelKey: item.labelKey, defaultLabel: item.defaultLabel } : null;
}

/** Group that owns a tab, or null for direct stops, Manager and Tournaments. */
export function groupForTab(tab: string): RailGroupId | null {
  return RAIL_GROUPS.find((g) => g.items.some((i) => i.tab === tab))?.id ?? null;
}

/**
 * The single roving-focus stop that represents a tab in the rail: the tab
 * itself for direct stops, `group:<id>` for grouped tabs, "" otherwise.
 */
export function railStopForTab(tab: string): string {
  if (RAIL_DIRECT.some((i) => i.tab === tab)) return tab;
  const group = groupForTab(tab);
  return group ? `group:${group}` : "";
}

export function defaultTabForGroup(id: RailGroupId): string {
  return RAIL_GROUPS.find((g) => g.id === id)?.items[0]?.tab ?? "";
}

/** Last visited tab of a group when it is still valid, else the group's first tab. */
export function resolveGroupLanding(
  id: RailGroupId,
  lastVisited: Partial<Record<RailGroupId, string>>,
): string {
  const last = lastVisited[id];
  const group = RAIL_GROUPS.find((g) => g.id === id);
  if (last && group?.items.some((i) => i.tab === last)) return last;
  return defaultTabForGroup(id);
}
