import type { TFunction } from "i18next";

import { championDisplayName } from "@/lib/champions/championNames";
import type { GameStateData } from "@/store/gameStore";
import { RAIL_GROUPS, groupForTab, navLabelFor } from "@/ui-v2/shell/navModel";
import type { DashboardLocation } from "./profileNavigation";

export type LocationKind = "tab" | "player" | "team" | "staff" | "champion";

export interface LocationDescription {
  title: string;
  kind: LocationKind;
}

export interface DescribeLocationDeps {
  t: TFunction;
  game: Pick<GameStateData, "players" | "teams" | "staff">;
}

/** Tabs the dashboard can show that the rail does not list. */
const OFF_RAIL_TABS: Record<string, { labelKey: string; defaultLabel: string }> = {
  Manager: { labelKey: "dashboard.manager", defaultLabel: "Head Coach" },
  Tournaments: { labelKey: "dashboard.tournaments", defaultLabel: "Tournaments" },
};

/** A tab's title: the label the navigation shows, else the tab id. */
export function tabTitle(tab: string, t: TFunction): string {
  const label = navLabelFor(tab) ?? OFF_RAIL_TABS[tab];
  return label ? t(label.labelKey, { defaultValue: label.defaultLabel }) : tab;
}

/** The label of the rail group that owns a tab, or null for a direct stop. */
export function groupTitle(tab: string, t: TFunction): string | null {
  const group = RAIL_GROUPS.find((g) => g.id === groupForTab(tab));
  return group ? t(group.labelKey, { defaultValue: group.defaultLabel }) : null;
}

/**
 * The one naming source for a location (R21): the h1, Back, the announcer and,
 * later, the palette and Recent. The champion page is checked first because it
 * keeps the profile it was opened from under it. A player, team or staff member
 * that is gone gives null, and the caller skips the entry. One whose name is
 * empty is named after its tab (R55): never an empty h1, "Back to " or "Now on , Club".
 */
export function describeLocation(
  loc: DashboardLocation,
  { t, game }: DescribeLocationDeps,
): LocationDescription | null {
  const named = (name: string | null | undefined, kind: LocationKind): LocationDescription => ({
    title: name?.trim() || tabTitle(loc.tab, t),
    kind,
  });
  if (loc.championKey !== null) {
    return named(championDisplayName(loc.championKey), "champion");
  }
  if (loc.playerId !== null) {
    const player = game.players.find((p) => p.id === loc.playerId);
    return player ? named(player.match_name, "player") : null;
  }
  if (loc.teamId !== null) {
    const team = game.teams.find((x) => x.id === loc.teamId);
    return team ? named(team.name, "team") : null;
  }
  if (loc.staffId !== null) {
    const member = game.staff.find((s) => s.id === loc.staffId);
    return member ? named(`${member.first_name} ${member.last_name}`, "staff") : null;
  }
  return { title: tabTitle(loc.tab, t), kind: "tab" };
}

/**
 * What a Back control is named after: the place it lands, or null only when
 * there is nowhere to go, so a working Back is never dimmed. Without game data
 * it names the target's tab (CR3).
 */
export function backTitle(
  target: DashboardLocation | null,
  deps: DescribeLocationDeps | null,
  t: TFunction,
): string | null {
  if (target === null) return null;
  return (deps && describeLocation(target, deps)?.title) || tabTitle(target.tab, t);
}

/**
 * What the route announcer says on arrival (R46): "Now on {title}, {group}", or
 * "Now on {title}" on a direct stop. The framing word keeps it apart from Back's
 * new name, which a screen reader may speak at the same moment.
 */
export function routeAnnouncement(loc: DashboardLocation, deps: DescribeLocationDeps): string | null {
  const here = describeLocation(loc, deps);
  if (!here) return null;
  const group = groupTitle(loc.tab, deps.t);
  return group
    ? deps.t("onAir.route.now", { title: here.title, group, defaultValue: "Now on {{title}}, {{group}}" })
    : deps.t("onAir.route.nowNoGroup", { title: here.title, defaultValue: "Now on {{title}}" });
}

/**
 * Name and state of an in-page Back button (R41). It takes the header's label, so
 * both controls name the same place; a page shown on its own, with no `backTo`,
 * keeps plain "Back".
 */
export function inPageBack(t: TFunction, backTo: string | null | undefined): { label: string; disabled: boolean } {
  if (backTo === undefined) return { label: t("common.back", { defaultValue: "Back" }), disabled: false };
  return { label: backControlLabel(t, backTo), disabled: backTo === null };
}

/** The name of a Back control: "Back to {destination}", or that there is nothing to go back to. */
export function backControlLabel(t: TFunction, destination: string | null): string {
  return destination === null
    ? t("onAir.bar.backNone", { defaultValue: "Nothing to go back to" })
    : t("onAir.bar.backTo", { destination, defaultValue: "Back to {{destination}}" });
}
