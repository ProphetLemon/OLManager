import type { TFunction } from "i18next";

import { callActionLabel } from "@/lib/dashboard/callLabels";
import { describeLocation, groupTitle, tabTitle } from "@/lib/dashboard/describeLocation";
import type { CallItem, CallState } from "@/lib/dashboard/needsYourCall";
import {
  RECENT_CAP,
  locationKey,
  sameLocation,
  type DashboardLocation,
} from "@/lib/dashboard/profileNavigation";
import { translatePositionLabel } from "@/lib/squad/helpers";
import { availableStaff, clubStaff } from "@/lib/staff/staffLists";
import type { GameStateData } from "@/store/gameStore";
import type { TabUiStates } from "@/store/tabUiStore";
import { RAIL_DIRECT, RAIL_GROUPS, groupForTab, resolveNavTab } from "@/ui-v2/shell/navModel";

import type { PaletteSearchable } from "./paletteSearch";

/** The tabUiStore slices that have a `view`. */
type ViewSlice = {
  [K in keyof TabUiStates]: TabUiStates[K] extends { view: unknown } ? K : never;
}[keyof TabUiStates];

type SliceTarget<K extends ViewSlice> = { slice: K; value: TabUiStates[K]["view"] };
type OtherViewSlice = Exclude<ViewSlice, "competitions">;

/**
 * The sub-view a Views row opens: the value to write in a tabUiStore slice's `view`.
 * A Competitions view opened with no league selected also carries the league to
 * select, the manager's own (R67).
 */
export type PaletteViewTarget =
  | { [K in OtherViewSlice]: SliceTarget<K> }[OtherViewSlice]
  | (SliceTarget<"competitions"> & { selectedCid?: string });

/** One part of a row's secondary text and the sign before it; the UI hides the sign from screen readers (R48). */
export interface PaletteDetail {
  text: string;
  sep: "›" | "·" | null;
}

interface EntryBase extends PaletteSearchable {
  /** Unique across groups: the same tab can sit in Recent and in Sections. */
  id: string;
  secondary: PaletteDetail[];
}

export type PaletteEntry =
  | (EntryBase & { kind: "call"; item: CallItem })
  | (EntryBase & { kind: "recent"; location: DashboardLocation })
  | (EntryBase & { kind: "section"; tab: string })
  | (EntryBase & { kind: "settings" })
  | (EntryBase & { kind: "view"; tab: string; view: PaletteViewTarget });

export interface PaletteIndexInput {
  /** DashboardV2's call state (R18): one row per decision. */
  callState: Pick<CallState, "decisionItems">;
  /** The location store's Recent, newest first. */
  recent: readonly DashboardLocation[];
  current: DashboardLocation;
  /** No club: Club is hidden, as in the rail. */
  unemployed: boolean;
  /** Schedule's Calendar exists only on a wide enough window, as in the tab. */
  scheduleCalendar: boolean;
  /** The Competitions tab's selected league (tabUiStore `competitions.selectedCid`). */
  selectedCompetitionId: string | null;
  game: Pick<GameStateData, "players" | "teams" | "staff" | "manager" | "leagues" | "user_competition_id">;
  t: TFunction;
}

interface ViewDef {
  tab: string;
  view: PaletteViewTarget;
  labelKey: string;
  defaultLabel: string;
  /** Schedule's Calendar. */
  wideOnly?: boolean;
  /** The label carries the view's {{count}}, as the Staff tab shows it. */
  count?: "club" | "available";
}

/** The 17 fixed sub-views (inventory §2), with each tab's own segment label. */
const VIEWS: ViewDef[] = [
  { tab: "Schedule", view: { slice: "schedule", value: "fixtures" }, labelKey: "schedule.matches", defaultLabel: "Matches" },
  {
    tab: "Schedule",
    view: { slice: "schedule", value: "calendar" },
    labelKey: "schedule.calendar",
    defaultLabel: "Calendar",
    wideOnly: true,
  },
  { tab: "Training", view: { slice: "training", value: "training" }, labelKey: "training.tab.training", defaultLabel: "Training" },
  { tab: "Training", view: { slice: "training", value: "soloq" }, labelKey: "training.tab.soloq", defaultLabel: "SoloQ" },
  { tab: "Staff", view: { slice: "staff", value: "mystaff" }, labelKey: "staff.myStaff", defaultLabel: "My Staff", count: "club" },
  { tab: "Staff", view: { slice: "staff", value: "available" }, labelKey: "staff.available", defaultLabel: "Available", count: "available" },
  { tab: "Finances", view: { slice: "finances", value: "overview" }, labelKey: "finances.overviewTab", defaultLabel: "Overview" },
  { tab: "Finances", view: { slice: "finances", value: "facilities" }, labelKey: "finances.facilitiesTab", defaultLabel: "Facilities" },
  { tab: "Transfers", view: { slice: "transfers", value: "my_list" }, labelKey: "transfers.myTransferList", defaultLabel: "My Transfer List" },
  { tab: "Transfers", view: { slice: "transfers", value: "market" }, labelKey: "transfers.transferMarket", defaultLabel: "Transfer Market" },
  { tab: "Transfers", view: { slice: "transfers", value: "erl" }, labelKey: "transfers.erlMarket", defaultLabel: "ERL Market" },
  { tab: "Transfers", view: { slice: "transfers", value: "loans" }, labelKey: "transfers.loanMarket", defaultLabel: "Loan Market" },
  { tab: "Transfers", view: { slice: "transfers", value: "offers" }, labelKey: "transfers.offers", defaultLabel: "Offers" },
  {
    tab: "Competitions",
    view: { slice: "competitions", value: "standings" },
    labelKey: "competitions.viewStandings",
    defaultLabel: "Standings",
  },
  { tab: "Competitions", view: { slice: "competitions", value: "calendar" }, labelKey: "schedule.calendar", defaultLabel: "Calendar" },
  { tab: "Competitions", view: { slice: "competitions", value: "teams" }, labelKey: "competitions.viewTeams", defaultLabel: "Teams" },
  { tab: "Competitions", view: { slice: "competitions", value: "players" }, labelKey: "competitions.viewPlayers", defaultLabel: "Players" },
];

/** A t that answers every key with its English default: the alias of a label. */
const english = ((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? "") as unknown as TFunction;

/** The manager's own tab, reached from the rail's avatar rather than a stop. */
const MANAGER_TAB = "Manager";

const detail = (parts: (string | null | undefined)[], sep: "›" | "·" = "·"): PaletteDetail[] =>
  parts.filter((p): p is string => Boolean(p)).map((text, i) => ({ text, sep: i === 0 ? null : sep }));

/**
 * Everything the Go palette can list (R26): one row per decision, the last 6
 * places, every section in rail order with Manager and one Settings row, and the
 * 17 fixed sub-views, which `searchPalette` shows only while typing. Labels are
 * resolved here, live, so Recent always names what is there now. There are no
 * actions (Continue, Save, Exit) and no Settings sections; finding unvisited
 * players, teams or staff by name is deferred (R28).
 *
 * NR2.8: memoize the call on [decisionItems, recent, game, lang, t]. Search
 * normalizes each row once per row object, so a rebuild per keystroke would
 * throw that away.
 */
export function buildPaletteIndex(input: PaletteIndexInput): PaletteEntry[] {
  const { t } = input;
  const hiddenGroups = new Set(
    RAIL_GROUPS.filter((g) => input.unemployed && g.hiddenWhenUnemployed).map((g) => g.id),
  );
  const isHidden = (tab: string) => {
    const group = groupForTab(tab);
    return group !== null && hiddenGroups.has(group);
  };
  return [
    ...callEntries(input),
    ...recentEntries(input, isHidden),
    ...sectionEntries(t, hiddenGroups),
    ...viewEntries(input, isHidden),
  ];
}

function callEntries({ callState, t }: PaletteIndexInput): PaletteEntry[] {
  return callState.decisionItems.map((item, order) => {
    const tab = resolveNavTab(item.target.tab);
    const zone = groupTitle(tab, t);
    const place = detail([zone, tabTitle(tab, t)], "›");
    return {
      kind: "call",
      id: `call:${item.id}`,
      group: "calls",
      order,
      item,
      label: callActionLabel(item, t),
      zone,
      alias: callActionLabel(item, english),
      headline: item.headline,
      secondary: [...place, { text: item.headline, sep: "·" }],
    };
  });
}

function recentEntries(input: PaletteIndexInput, isHidden: (tab: string) => boolean): PaletteEntry[] {
  const { t, game } = input;
  const rows: PaletteEntry[] = [];
  const seen = new Set<string>();
  for (const location of input.recent) {
    if (rows.length === RECENT_CAP) break;
    const key = locationKey(location);
    if (seen.has(key) || sameLocation(location, input.current)) continue;
    seen.add(key);
    const here = describeLocation(location, { t, game });
    // A hidden Club tab goes, but a profile opened over it is a place of its own and stays.
    if (!here || (here.kind === "tab" && isHidden(location.tab))) continue;
    const zone = here.kind === "tab" ? groupTitle(location.tab, t) : null;
    rows.push({
      kind: "recent",
      id: `recent:${key}`,
      group: "recent",
      order: rows.length,
      location,
      label: here.title,
      zone,
      alias: here.kind === "tab" ? tabTitle(location.tab, english) : "",
      secondary: here.kind === "tab" ? detail([zone]) : profileDetail(location, input),
    });
  }
  return rows;
}

/** A recent profile's secondary text: "Player · Fnatic · ADC · 86 OVR" (artboard). */
function profileDetail(location: DashboardLocation, { t, game }: PaletteIndexInput): PaletteDetail[] {
  const teamName = (id: string | null | undefined) => game.teams.find((team) => team.id === id)?.name;
  if (location.championKey !== null) {
    return detail([t("championPage.champion", { defaultValue: "Champion" })]);
  }
  if (location.playerId !== null) {
    const player = game.players.find((p) => p.id === location.playerId);
    const position = player?.position
      ? translatePositionLabel((key, options) => t(key, options) as string, player.position)
      : null;
    const ovr = typeof player?.lol_ovr === "number" ? `${player.lol_ovr} ${t("common.ovr", { defaultValue: "OVR" })}` : null;
    return detail([t("common.player", { defaultValue: "Player" }), teamName(player?.team_id), position, ovr]);
  }
  if (location.teamId !== null) {
    return detail([t("common.team", { defaultValue: "Team" })]);
  }
  const member = game.staff.find((s) => s.id === location.staffId);
  const role = member ? t(`staff.roles.${member.role}`, { defaultValue: member.role }) : null;
  return detail([t("dashboard.staff", { defaultValue: "Staff" }), teamName(member?.team_id), role]);
}

function sectionEntries(t: TFunction, hiddenGroups: Set<string>): PaletteEntry[] {
  const rows: PaletteEntry[] = [];
  const section = (tab: string, zone: string | null) => {
    rows.push({
      kind: "section",
      id: `section:${tab}`,
      group: "sections",
      order: rows.length,
      tab,
      label: tabTitle(tab, t),
      zone,
      alias: tabTitle(tab, english),
      secondary: detail([zone]),
    });
  };
  for (const item of RAIL_DIRECT) section(item.tab, null);
  for (const group of RAIL_GROUPS) {
    if (hiddenGroups.has(group.id)) continue;
    const zone = t(group.labelKey, { defaultValue: group.defaultLabel });
    for (const item of group.items) section(item.tab, zone);
  }
  section(MANAGER_TAB, null);
  rows.push({
    kind: "settings",
    id: "settings",
    group: "sections",
    order: rows.length,
    label: t("dashboard.settings", { defaultValue: "Settings" }),
    zone: null,
    alias: "Settings",
    secondary: [],
  });
  return rows;
}

/**
 * The league a Competitions view needs selected: none when one already is, the
 * manager's own when none is, and null when the manager has none either, which
 * hides the rows rather than land on the "select a competition" prompt (R67).
 */
function competitionToSelect({ game, selectedCompetitionId }: PaletteIndexInput): { select: string | null } | null {
  const leagues = game.leagues ?? [];
  // The Competitions tab keys a league as `competition_id ?? id`.
  if (leagues.some((league) => (league.competition_id ?? league.id) === selectedCompetitionId)) return { select: null };
  const own = game.user_competition_id;
  return own && leagues.some((league) => league.competition_id === own) ? { select: own } : null;
}

function viewEntries(input: PaletteIndexInput, isHidden: (tab: string) => boolean): PaletteEntry[] {
  const { t, game } = input;
  const counts = {
    club: () => clubStaff(game.staff, game.manager.team_id).length,
    available: () => availableStaff(game.staff).length,
  };
  const league = competitionToSelect(input);
  const shown = (def: ViewDef) =>
    !isHidden(def.tab) &&
    (!def.wideOnly || input.scheduleCalendar) &&
    (def.view.slice !== "competitions" || league !== null);
  return VIEWS.filter(shown).map((def, order) => {
    const zone = groupTitle(def.tab, t);
    const view: PaletteViewTarget =
      def.view.slice === "competitions" && league?.select ? { ...def.view, selectedCid: league.select } : def.view;
    return {
      kind: "view",
      id: `view:${def.tab}:${def.view.value}`,
      group: "views",
      order,
      tab: def.tab,
      view,
      label: def.count
        ? t(def.labelKey, { defaultValue: def.defaultLabel, count: counts[def.count]() })
        : t(def.labelKey, { defaultValue: def.defaultLabel }),
      labelPrefix: tabTitle(def.tab, t),
      zone,
      alias: def.defaultLabel,
      secondary: detail([zone]),
    };
  });
}
