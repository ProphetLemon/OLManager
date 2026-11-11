import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type Tree = Record<string, unknown>;

const LOCALES: Record<string, Tree> = { es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr };

function lookup(tree: Tree, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], tree);
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
}

/** Texts that were English in every locale and are now translated. */
const TRANSLATED_KEYS = [
  "match.continue",
  "match.draftStrategy",
  "match.game",
  "match.opponentIntel.kicker",
  "match.opponentIntel.title",
  "match.opponentIntel.confidence",
  "match.opponentIntel.rivalPoolByRole",
  "match.opponentIntel.noPoolYet",
  "match.opponentIntel.suggestedBans",
  "match.opponentIntel.threat",
  "match.opponentIntel.metaThreats",
  "match.opponentIntel.masteryHighlights",
  "dashboard.competitions",
  "transfers.browseMarket",
  "competitions.title",
  "competitions.heroSeason",
  "competitions.heroTeams_one",
  "competitions.heroTeams_other",
  "competitions.heroMatches_one",
  "competitions.heroMatches_other",
  "competitions.viewStandings",
  "competitions.viewTeams",
  "competitions.viewPlayers",
  "competitions.tableHeader.team",
  "competitions.tableHeader.diff",
  "competitions.tableHeader.player",
  "competitions.tableHeader.role",
  "competitions.noStandings",
  "competitions.searchTeam",
  "competitions.noTeamsMatch",
  "competitions.noTeams",
  "competitions.searchPlayer",
  "competitions.noPlayersMatch",
  "competitions.noPlayers",
  "competitions.selectPrompt",
  "scouting.academyPendingTitle",
  "scouting.academyDescription",
  "scouting.noScoutsTitle",
  "scouting.noScoutsDescription",
  "scouting.hireScoutCta",
  "scouting.benefitEvaluate",
  "scouting.benefitEvaluateDesc",
  "scouting.benefitCompare",
  "scouting.benefitCompareDesc",
  "scouting.benefitDiscover",
  "scouting.benefitDiscoverDesc",
  "playerProfile.alsoPlays",
  "playerProfile.editPosition",
  "playerProfile.transferListed",
  "playerProfile.loanListed",
  "playerProfile.potentialResearchProgress",
  "playerProfile.startPotentialResearch",
  "playerProfile.careerSeasonColumn",
] as const;

/** Keys that did not exist; the English text is the source. */
const NEW_KEYS = [
  "match.opponentIntel.quality.low",
  "match.opponentIntel.quality.medium",
  "match.opponentIntel.quality.high",
  "match.opponentIntel.roleUnknown",
  "staff.adjustFiltersHint",
  "staff.hireFromAvailableHint",
  "staff.allStaffEmployedHint",
  "transfers.destination",
  "transfers.mainTeamDestination",
  "transfers.freeAgentSigningHint",
  "transfers.bidImpactTitle",
  "transfers.bidImpactTransferBudget",
  "transfers.bidImpactBalance",
  "transfers.bidImpactWagePressure",
  "transfers.bidImpactOverTransferBudget",
  "transfers.bidImpactOverBalance",
  "playerProfile.transferOfferDestination",
  "playerProfile.transferOfferMainTeam",
  "be.msg.contractTerminated.subject",
  "be.msg.contractTerminated.body",
  "finances.wagePerYear",
  ...[
    "complete",
    "discoveryEffect",
    "discoveryStats",
    "gainMaximum",
    "gainMinimal",
    "gainModerate",
    "masteryEffect",
    "noPlayers",
    "patchMeta",
    "priorityHigh",
    "priorityLow",
    "priorityMedium",
    "tierDiscovered_one",
    "tierDiscovered_other",
    "unknownPatch",
    "updated",
  ].map((key) => `meta.${key}`),
  "champions.delegateToCoach",
  "champions.delegating",
  "champions.masteryTrainingTitle",
  "champions.noTarget",
  ...[
    "Salary",
    "StaffWage",
    "FacilityUpkeep",
    "FacilityUpgrade",
    "TransferPurchase",
    "TransferSale",
    "ReleasePenalty",
    "AcademyAcquisition",
    "Sponsorship",
    "MatchdayRevenue",
    "PrizeMoney",
    "BudgetRefresh",
    "Other",
  ].map((kind) => `finances.ledgerKinds.${kind}`),
] as const;

/** Words that are the same in the target language as in English. */
const SAME_AS_ENGLISH: Record<string, string[]> = {
  "competitions.tableHeader.diff": ["fr", "de", "it"],
  "competitions.heroMatches_one": ["fr"],
  "competitions.viewTeams": ["de"],
  "competitions.tableHeader.team": ["de"],
  "transfers.destination": ["fr"],
  "playerProfile.transferOfferDestination": ["fr"],
};

describe("texts that were left in English", () => {
  const all = [...TRANSLATED_KEYS, ...NEW_KEYS];

  it.each(Object.keys(LOCALES))("%s has every key with the placeholders of the English text", (locale) => {
    for (const key of all) {
      const source = lookup(en, key);
      const text = lookup(LOCALES[locale], key);
      expect(typeof source, `${key} in en`).toBe("string");
      expect(typeof text, `${key} in ${locale}`).toBe("string");
      expect(placeholders(text as string), `${key} placeholders in ${locale}`).toEqual(
        placeholders(source as string),
      );
    }
  });

  it.each(Object.keys(LOCALES))("%s translates every key", (locale) => {
    for (const key of all) {
      const allowed = SAME_AS_ENGLISH[key]?.includes(locale);
      if (allowed) continue;
      expect(lookup(LOCALES[locale], key), `${key} in ${locale}`).not.toBe(lookup(en, key));
    }
  });

  it("keeps the euro sign out of the amount placeholders of the at-risk wages text", () => {
    for (const tree of [en, ...Object.values(LOCALES)]) {
      expect(lookup(tree, "finances.atRiskWages")).not.toContain("€");
    }
  });
});
