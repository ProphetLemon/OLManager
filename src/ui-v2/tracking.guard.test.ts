import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");
const SCAN_ROOT = join(SRC_ROOT, "ui-v2");

// Same exclusions as tokens.guard.test.ts: the primitives keep their own tracking.
const EXCLUDED = ["ui-v2/components/ui/", "ui-v2/shell/", "FloatingBugButton", "tracking.guard.test.ts", "tokens.guard.test.ts"];

// Rule: a label in capitals uses font-heading, a size token and `tracking-wide`.
// `tracking-wider` and `tracking-widest` are not used in UI v2 code.
const HEAVY_TRACKING = /(?<![\w-])tracking-(?:wider|widest)(?![\w-])/g;

/**
 * Files that still carry heavy tracking, with the exact number of occurrences.
 * This is a ratchet: it may only shrink. Converting a file means lowering or removing
 * its entry; the guard also fails when an entry is stale (the file has fewer
 * occurrences than listed), so the list cannot silently grow back.
 */
const BASELINE: Record<string, number> = {
  "ui-v2/_legacy/components/EndOfSeasonScreen.tsx": 9,
  "ui-v2/_legacy/components/dashboard/DashboardAlerts.tsx": 1,
  "ui-v2/_legacy/components/dashboard/DashboardBlockerModal.tsx": 3,
  "ui-v2/_legacy/components/dashboard/DashboardCloseConfirmModal.tsx": 3,
  "ui-v2/_legacy/components/dashboard/DashboardExitConfirmModal.tsx": 3,
  "ui-v2/_legacy/components/dashboard/DashboardMatchConfirmModal.tsx": 3,
  "ui-v2/_legacy/components/dashboard/FiredModal.tsx": 1,
  "ui-v2/_legacy/components/dashboard/ReportBugModal.tsx": 6,
  "ui-v2/_legacy/components/match/MatchTacticsStage.tsx": 3,
  "ui-v2/_legacy/components/match/OpponentIntelCard.tsx": 5,
  "ui-v2/_legacy/components/match/PreMatchLineup.tsx": 13,
  "ui-v2/_legacy/components/match/PreMatchSetup.tsx": 3,
  "ui-v2/_legacy/components/match/PressConference.tsx": 3,
  "ui-v2/_legacy/components/menu/CommunityPanel.tsx": 3,
  "ui-v2/_legacy/components/menu/PatchNotesPanel.tsx": 3,
  "ui-v2/_legacy/components/menu/SavesList.tsx": 4,
  "ui-v2/_legacy/components/playoffs/PlayoffBracketBoard.tsx": 2,
  "ui-v2/_legacy/components/schedule/ScheduleCalendarView.tsx": 8,
  "ui-v2/_legacy/components/tactics/TacticsTab.tsx": 2,
  "ui-v2/_legacy/components/teamSelection/LeaguePickerV2.tsx": 1,
  "ui-v2/_legacy/components/teamSelection/TeamGridV2.tsx": 1,
  "ui-v2/_legacy/components/ui/Badge.tsx": 1,
  "ui-v2/_legacy/components/ui/Button.tsx": 1,
  "ui-v2/_legacy/components/ui/Input.tsx": 1,
  "ui-v2/_legacy/components/ui/RoleBadge.tsx": 3,
  "ui-v2/_legacy/components/ui/Textarea.tsx": 1,
  "ui-v2/_legacy/components/updater/UpdateModal.tsx": 3,
  "ui-v2/_legacy/pages/MainMenu.tsx": 9,
  "ui-v2/_legacy/pages/MatchSimulation.tsx": 1,
  "ui-v2/_legacy/pages/Settings.tsx": 13,
  "ui-v2/components/ChampionsGridV2.tsx": 3,
  "ui-v2/components/DraftResultScreenV2.tsx": 12,
  "ui-v2/components/ErrorBoundary.tsx": 1,
  "ui-v2/components/LeaguePickerMapV2.tsx": 3,
  "ui-v2/components/RosterOverlayPanel.tsx": 1,
  "ui-v2/components/TitleBarV2.test.tsx": 1,
  "ui-v2/components/TitleBarV2.tsx": 1,
  "ui-v2/components/negotiation/NegotiationFeedbackPanel.tsx": 1,
  "ui-v2/components/negotiation/TransferNegotiationHistory.tsx": 1,
  "ui-v2/components/season/PromotionRelegationCard.tsx": 1,
  "ui-v2/dashboard/tabs/FinancesTabV2.tsx": 22,
  "ui-v2/dashboard/tabs/InboxTabV2.tsx": 1,
  "ui-v2/dashboard/tabs/MarketTabV2.tsx": 3,
  "ui-v2/dashboard/tabs/MetaTabV2.tsx": 6,
  "ui-v2/dashboard/tabs/NewsTabV2.tsx": 3,
  "ui-v2/dashboard/tabs/PlayersTabV2.tsx": 5,
  "ui-v2/dashboard/tabs/RosterLineupV2.tsx": 4,
  "ui-v2/dashboard/tabs/ScheduleTabV2.tsx": 8,
  "ui-v2/dashboard/tabs/ScoutingAssignmentsListV2.tsx": 1,
  "ui-v2/dashboard/tabs/ScoutingPlayerSearchCardV2.tsx": 4,
  "ui-v2/dashboard/tabs/ScoutingScoutDetailsCardV2.tsx": 3,
  "ui-v2/dashboard/tabs/ScoutingTabV2.tsx": 8,
  "ui-v2/dashboard/tabs/SocialTabV2.tsx": 1,
  "ui-v2/dashboard/tabs/SoloqTabV2.tsx": 6,
  "ui-v2/dashboard/tabs/StaffTabV2.tsx": 10,
  "ui-v2/dashboard/tabs/TacticsTabV2.tsx": 4,
  "ui-v2/dashboard/tabs/TeamsTabV2.tsx": 4,
  "ui-v2/dashboard/tabs/TrainingTabV2.tsx": 25,
  "ui-v2/dashboard/tabs/TransfersTabV2.tsx": 6,
  "ui-v2/dashboard/tabs/YouthTabV2.tsx": 9,
  "ui-v2/dashboard/tabs/news/NewsArticleViews.tsx": 6,
  "ui-v2/dashboard/tabs/social/SocialComposer.tsx": 1,
  "ui-v2/dashboard/tabs/social/SocialPostItem.tsx": 2,
  "ui-v2/dashboard/tabs/transfers/TransferBidDialog.tsx": 3,
  "ui-v2/dashboard/tabs/transfers/TransferCounterOfferDialog.tsx": 2,
  "ui-v2/dashboard/tabs/transfers/TransferDialogParts.tsx": 1,
  "ui-v2/dashboard/tabs/transfers/WageNegotiationDialog.tsx": 2,
  "ui-v2/pages/ChampionPageV2.tsx": 10,
  "ui-v2/pages/StaffProfileV2.tsx": 10,
  "ui-v2/pages/TeamProfileV2.tsx": 1,
  "ui-v2/pages/TeamSelectionV2.tsx": 2,
  "ui-v2/pages/customTeam/CustomTeamWizardV2.tsx": 13,
  "ui-v2/pages/customTeam/LogoUploadControl.tsx": 1,
  "ui-v2/pages/playerProfile/PlayerProfileAttributesCardV2.tsx": 3,
  "ui-v2/pages/playerProfile/PlayerProfileCareerCardV2.tsx": 1,
  "ui-v2/pages/playerProfile/PlayerProfileHeroCardV2.tsx": 5,
  "ui-v2/pages/playerProfile/PlayerProfileMatchHistoryCardV2.tsx": 1,
  "ui-v2/pages/playerProfile/PlayerProfileReleaseModalV2.tsx": 2,
  "ui-v2/pages/playerProfile/PlayerProfileRenewalModalV2.tsx": 2,
  "ui-v2/pages/playerProfile/PlayerProfileScoutActionV2.tsx": 2,
  "ui-v2/pages/playerProfile/PlayerProfileSectionV2.tsx": 1,
  "ui-v2/pages/playerProfile/PlayerProfileStatsCardV2.tsx": 1,
  "ui-v2/pages/playerProfile/PlayerProfileTransferOfferModalV2.tsx": 5,
  "ui-v2/pages/playerProfile/modalFieldStyles.ts": 1,
  "ui-v2/pages/teamProfile/TeamProfileHeroCardV2.tsx": 2,
  "ui-v2/pages/teamProfile/TeamProfileInfoCardsV2.tsx": 4,
  "ui-v2/pages/teamProfile/TeamProfilePrimitivesV2.tsx": 1,
  "ui-v2/pages/teamProfile/TeamProfileRecordCardsV2.tsx": 4,
  "ui-v2/pages/teamProfile/TeamProfileRosterCardV2.tsx": 2,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of walk(SCAN_ROOT)) {
    const rel = relative(SRC_ROOT, file).split("\\").join("/");
    if (EXCLUDED.some((part) => rel.includes(part))) continue;
    const matches = readFileSync(file, "utf8").match(HEAVY_TRACKING);
    if (matches) counts[rel] = matches.length;
  }
  return counts;
}

describe("letter-spacing guard", () => {
  it("matches only the heavy tracking utilities", () => {
    const hits = (s: string) => (s.match(HEAVY_TRACKING) ?? []).length;
    expect(hits('className="uppercase tracking-wider"')).toBe(1);
    expect(hits("tracking-widest md:tracking-wider")).toBe(2);
    expect(hits("tracking-wide")).toBe(0);
    expect(hits("tracking-tight")).toBe(0);
  });

  it("does not add tracking-wider or tracking-widest to UI v2 code", () => {
    const grown = Object.entries(currentCounts())
      .filter(([rel, n]) => n > (BASELINE[rel] ?? 0))
      .map(([rel, n]) => `${rel}: ${n} > ${BASELINE[rel] ?? 0}`);
    expect(grown).toEqual([]);
  });

  it("keeps the baseline tight so it only shrinks", () => {
    const counts = currentCounts();
    const stale = Object.entries(BASELINE)
      .filter(([rel, n]) => (counts[rel] ?? 0) < n)
      .map(([rel, n]) => `${rel}: baseline ${n}, now ${counts[rel] ?? 0}`);
    expect(stale).toEqual([]);
  });

  it("keeps the converted dashboard tabs free of heavy tracking", () => {
    const converted = [
      "ui-v2/dashboard/tabs/CompetitionsTabV2.tsx",
      "ui-v2/dashboard/tabs/ScrimPlanningCardV2.tsx",
      "ui-v2/dashboard/tabs/ScrimsTabV2.tsx",
      "ui-v2/dashboard/tabs/ManagerTabV2.tsx",
    ];
    for (const rel of converted) expect(BASELINE[rel]).toBeUndefined();
  });
});
