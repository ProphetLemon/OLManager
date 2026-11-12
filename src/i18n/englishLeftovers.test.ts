import { describe, expect, it } from "vitest";
import debt from "./englishLeftovers.debt.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import it_ from "./locales/it.json";
import pt from "./locales/pt.json";
import ptBR from "./locales/pt-BR.json";
import tr from "./locales/tr.json";

type Tree = { [key: string]: unknown };

function flatten(node: Tree, prefix = "", out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (value && typeof value === "object") flatten(value as Tree, path, out);
  }
  return out;
}

// A value only counts as text when it has a letter outside the {{placeholders}}.
function hasText(value: string) {
  return /\p{L}/u.test(value.replace(/\{\{[^}]*\}\}/g, ""));
}

const enFlat = flatten(en as Tree);

function identicalKeys(locale: Tree) {
  const flat = flatten(locale);
  return Object.keys(enFlat)
    .filter((key) => key in flat && flat[key] === enFlat[key] && hasText(enFlat[key]))
    .sort();
}

// Spanish: a value equal to English fails unless the key is listed here with a reason.
const ES_ALLOWED: ReadonlyArray<{ reason: string; keys: readonly string[] }> = [
  {
    reason: "Brand, product, media and person names that are never translated",
    keys: [
      "app.name",
      "app.version",
      "be.role.allioPodcast",
      "be.role.elYuste",
      "be.sender.alLio",
      "be.sender.allioPodcast",
      "be.sender.elYuste",
      "be.sender.esportmaniacos",
      "be.sender.press",
      "be.sender.yuste",
      "be.source.leagueChronicle",
      "be.source.leaguePulse",
      "be.source.leagueWire",
      "be.source.lolEsports",
      "be.source.matchDayPress",
      "be.source.riftHerald",
      "be.source.riftWire",
      "be.source.sportsGazette",
      "dashboard.brandSubtitle",
      "dashboard.brandTitle",
      "leaguePicker.china",
      "sidebar.bundesliga",
      "sidebar.leaguesInsider",
      "sidebar.ligue1",
      "sidebar.premier",
      "sidebar.serieA",
      "teamProfile.erl",
      "titleBar.appName",
    ],
  },
  {
    reason: "Esports terms that the Spanish UI keeps in English",
    keys: [
      "be.msg.scrimWeekly.focus.macro",
      "be.msg.scrimWeekly.focus.mental",
      "be.msg.scrimWeekly.issues.tilt",
      "be.role.podcast",
      "be.role.streamer",
      "championPage.roles",
      "champions.counterpicks",
      "champions.roles",
      "common.soloq",
      "createManager.soloq",
      "dashboard.manager",
      "dashboard.meta",
      "dashboard.phaseLabels.scrimBlock",
      "dashboard.scrims",
      "dashboard.social",
      "dashboard.soloq",
      "dashboard.staff",
      "dashboard.worldStaff",
      "finances.ledgerSource.staff",
      "home.phase.scrimBlock.title",
      "manager.staff",
      "match.draft.actions.ban",
      "match.draft.actions.pick",
      "match.draft.masterySourceScouting",
      "match.draft.title",
      "match.draftResult.mvp",
      "match.liveA11y.voidgrubIcon",
      "match.liveMap.elemental",
      "match.opponentIntel.meta",
      "match.scrimPrep.focus.macro",
      "menu.manager",
      "onAir.bar.phase.scrimBlock",
      "playerProfile.championInsignia",
      "playerProfile.lolStatGroups.gameIq",
      "playerProfile.lolStatGroups.gameplay",
      "playerProfile.lolStats.championPool",
      "playerProfile.lolStats.laning",
      "playerProfile.lolStats.macro",
      "playerProfile.lolStats.shotcalling",
      "playerProfile.lolStats.teamfighting",
      "schedule.playoffs",
      "schedule.scrimVs",
      "scrims.manualControl",
      "scrims.manualLabel",
      "scrims.tag.mentalMinus",
      "scrims.tag.mentalPlus",
      "scrims.tags.mentalMinus",
      "scrims.tags.mentalPlus",
      "settings.staff",
      "social.title",
      "soloqDecay.lossValue",
      "soloqDecay.modes.real",
      "soloqDecay.winBackValue",
      "soloqHistory.chart.nowTier",
      "soloqHistory.floorTier",
      "soloqHistory.hero.label",
      "soloqHistory.lpValue",
      "soloqHistory.table.lp",
      "tactics.lol.options.fightPlan.Dive.label",
      "tactics.lol.options.fightPlan.FrontToBack.label",
      "tactics.lol.options.fightPlan.Siege.label",
      "tactics.lol.options.gameTiming.Early.label",
      "tactics.lol.options.gameTiming.Late.label",
      "tactics.lol.options.gameTiming.Mid.label",
      "tactics.lol.options.junglePathing.BotToTop.label",
      "tactics.lol.options.junglePathing.TopToBot.label",
      "teamProfile.managerLabel",
      "teams.draftIdentity",
      "tournaments.bracket",
      "tournaments.lowerBracket",
      "tournaments.upperBracket",
      "training.scrims.planA",
      "training.scrims.planB",
      "training.scrims.planC",
      "training.tab.soloq",
    ],
  },
  {
    reason: "Abbreviations and short stat labels that read the same in Spanish",
    keys: [
      "championPage.br",
      "championPage.cs",
      "championPage.kda",
      "championPage.pr",
      "championPage.wr",
      "common.loanListed",
      "common.ovr",
      "common.pts",
      "common.transferListed",
      "common.vs",
      "competitions.tableHeader.ovr",
      "competitions.tableHeader.pts",
      "competitions.tableHeader.wr",
      "date.day",
      "match.draft.scoreLine",
      "onAir.home.vsAt.home",
      "playerProfile.championWinRateShort",
      "playerProfile.rename.nick",
      "playerProfile.vs",
      "players.colOvr",
      "players.colPos",
      "scouting.pos",
      "scrims.rivalRep",
      "squad.pos",
      "teamProfile.killsDeathsObjectives",
      "teamProfile.winRate",
      "teamSelect.founders.dialog.fields.nick",
      "teams.colOvr",
      "teams.colPos",
      "teams.colRep",
      "teams.colWr",
      "teams.rep",
      "teams.statOvr",
      "teams.statPts",
      "teams.statRep",
      "teams.winRateShort",
      "teamsList.pos",
      "teamsList.rep",
      "tournaments.deathsShort",
      "tournaments.killsShort",
      "tournaments.winRateShort",
      "youthAcademy.ovr",
      "youthAcademy.pos",
    ],
  },
  {
    reason: "Esports roles and role abbreviations (stay in English in es)",
    keys: [
      "be.role.adc",
      "be.role.mid",
      "be.role.top",
      "common.posAbbr.AttackingMidfielder",
      "common.posAbbr.CenterBack",
      "common.posAbbr.CentralMidfielder",
      "common.posAbbr.Defender",
      "common.posAbbr.DefensiveMidfielder",
      "common.posAbbr.Forward",
      "common.posAbbr.Goalkeeper",
      "common.posAbbr.LeftBack",
      "common.posAbbr.LeftMidfielder",
      "common.posAbbr.LeftWingBack",
      "common.posAbbr.LeftWinger",
      "common.posAbbr.Midfielder",
      "common.posAbbr.RightBack",
      "common.posAbbr.RightMidfielder",
      "common.posAbbr.RightWingBack",
      "common.posAbbr.RightWinger",
      "common.posAbbr.Striker",
      "common.positions.AttackingMidfielder",
      "common.positions.CenterBack",
      "common.positions.CentralMidfielder",
      "common.positions.Defender",
      "common.positions.DefensiveMidfielder",
      "common.positions.Forward",
      "common.positions.Goalkeeper",
      "common.positions.LeftBack",
      "common.positions.LeftMidfielder",
      "common.positions.LeftWingBack",
      "common.positions.LeftWinger",
      "common.positions.Midfielder",
      "common.positions.RightBack",
      "common.positions.RightMidfielder",
      "common.positions.RightWingBack",
      "common.positions.RightWinger",
      "common.positions.Striker",
      "onAir.roles.ADC",
      "onAir.roles.MID",
      "onAir.roles.SUPPORT",
      "onAir.roles.TOP",
      "tactics.lol.options.strongSide.Bot.label",
      "tactics.lol.options.strongSide.Mid.label",
      "tactics.lol.options.strongSide.Top.label",
      "teams.roleSetupValue",
    ],
  },
  {
    reason: "Words spelled the same in Spanish",
    keys: [
      "auth.email",
      "champions.totalChampions",
      "common.trainingFocuses.General",
      "dashboard.sectionClub",
      "finances.ledgerSource.manual",
      "home.finances.balance",
      "manager.club",
      "market.filterAiTransfers",
      "match.draft.total",
      "match.draftResult.finalGold",
      "match.normal",
      "news.categories.Editorial",
      "sacked.teamLabel",
      "settings.speeds.normal",
      "teamProfile.balance",
      "tournaments.playoffFinal",
      "traits.BallWinner.label",
    ],
  },
];

const esAllowed = new Map<string, string>();
for (const { reason, keys } of ES_ALLOWED) for (const key of keys) esAllowed.set(key, reason);

// Other locales: the keys that were still identical to English when this guard was added.
// The list only shrinks: translate a key, then delete it from englishLeftovers.debt.json.
const DEBT: Record<string, readonly string[]> = debt;
const OTHER_LOCALES: Record<string, Tree> = {
  de: de as Tree,
  fr: fr as Tree,
  it: it_ as Tree,
  pt: pt as Tree,
  "pt-BR": ptBR as Tree,
  tr: tr as Tree,
};

describe("English leftovers: es", () => {
  const identical = identicalKeys(es as Tree);

  it("has no value identical to English unless the key is allowlisted", () => {
    const unexplained = identical.filter((key) => !esAllowed.has(key));
    expect(unexplained, "Translate these es values or add them to ES_ALLOWED with a reason").toEqual([]);
  });

  it("keeps every allowlist entry honest", () => {
    const stale = [...esAllowed.keys()].filter((key) => !identical.includes(key));
    expect(stale, "These ES_ALLOWED keys are no longer identical to English: remove them").toEqual([]);
  });
});

describe.each(Object.keys(OTHER_LOCALES))("English leftovers: %s", (code) => {
  const identical = identicalKeys(OTHER_LOCALES[code]);
  const known = new Set(DEBT[code] ?? []);

  it("adds no new value identical to English", () => {
    const added = identical.filter((key) => !known.has(key));
    expect(added, `Translate these ${code} values; the known debt list may only shrink`).toEqual([]);
  });

  it("removes translated keys from the known debt list", () => {
    const now = new Set(identical);
    const fixed = [...known].filter((key) => !now.has(key));
    expect(
      fixed,
      `These ${code} keys no longer equal English: remove them from englishLeftovers.debt.json`,
    ).toEqual([]);
  });
});
