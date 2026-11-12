import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DECISION_IMPACT_TAGS } from "../../lib/scrims/decisionTags";
import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type Tree = { [key: string]: string | Tree };

const LOCALES: Record<string, Tree> = {
  en: en as Tree,
  de: de as Tree,
  es: es as Tree,
  fr: fr as Tree,
  it: itLocale as Tree,
  pt: pt as Tree,
  "pt-BR": ptBR as Tree,
  tr: tr as Tree,
};

function lookup(locale: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = locale;
  for (const part of key.split(".")) {
    if (!node || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

/**
 * Keys that must exist in all 8 locales with the same placeholders as English and a
 * text of their own (a copy of the English string is a defect), unless the word is the
 * same in a language, which `sameAsEnglishOk` lists per key.
 */
function expectTranslated(keys: readonly string[], sameAsEnglishOk: Record<string, readonly string[]> = {}) {
  for (const key of keys) {
    const english = lookup(LOCALES.en, key);
    expect(english, `${key} in en`).toBeTruthy();
    for (const [lang, tree] of Object.entries(LOCALES)) {
      const text = lookup(tree, key);
      expect(text, `${key} in ${lang}`).toBeTruthy();
      expect(placeholders(text!), `${key} placeholders in ${lang}`).toEqual(placeholders(english!));
      if (lang !== "en" && !sameAsEnglishOk[key]?.includes(lang)) {
        expect(text, `${key} in ${lang} is the English text`).not.toBe(english);
      }
    }
  }
}

describe("end-of-season summary keys", () => {
  it("translates the period titles and the league line in every locale", () => {
    expectTranslated(
      [
        "endOfSeason.newSeason",
        "endOfSeason.newSplit",
        "endOfSeason.leagueSeason",
        "endOfSeason.newScheduleReleased",
        "endOfSeason.seasonComplete",
        "endOfSeason.startNextSeason",
        "tournaments.playoffBracketTitle",
      ],
    );
  });
});

describe("inbox message keys", () => {
  it("translates the board, community, call-up, press and sponsor messages in every locale", () => {
    expectTranslated(
      [
        "boardConfidence.subject",
        "boardConfidence.body0",
        "boardConfidence.body1",
        "community.subject0",
        "community.subject1",
        "community.body0",
        "community.body1",
        "intlCallup.subject",
        "intlCallup.body",
        "mediaNegative.subject",
        "mediaNegative.body",
        "mediaPositive.subject",
        "mediaPositive.body",
        "sponsor.subject",
      ].map((key) => `be.msg.${key}`),
    );
  });
});

describe("advance blocker keys", () => {
  it("words the roster, contract and inbox blockers in every locale", () => {
    expectTranslated(
      [
        "urgentMessages_one",
        "urgentMessages_other",
        "incompleteLineupTooFew",
        "incompleteLineupRoles_one",
        "incompleteLineupRoles_other",
        "keyContractRisk",
        "contractWageRisk",
        "mainRosterMinimum_one",
        "mainRosterMinimum_other",
        "mainMissingRoles",
        "academyMissingRoles",
      ].map((key) => `advance.blockers.${key}`),
    );
  });
});

/** Keys a Scrims tab component asks for with a literal `t("...")` call. */
function literalKeys(file: string): string[] {
  const source = readFileSync(resolve(__dirname, "../../ui-v2/dashboard/tabs", file), "utf-8");
  return [...source.matchAll(/\bt\(\s*["`]([A-Za-z0-9_.]+)["`]/g)].map((match) => match[1]);
}

/** Every component file of the Scrims desk, so a new one is covered without being listed. */
function scrimDeskFiles(): string[] {
  return readdirSync(resolve(__dirname, "../../ui-v2/dashboard/tabs/scrims"))
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => `scrims/${name}`);
}

describe("Scrims tab keys", () => {
  // Words that are the same in these languages (cognates and loanwords), not a missed translation.
  const sameAsEnglishOk: Record<string, readonly string[]> = {
    "scrims.delegation": ["de"],
    "scrims.manualControl": ["es", "pt", "pt-BR"],
    "scrims.manualLabel": ["es", "pt", "pt-BR"],
    "scrims.block": ["de"],
    "scrims.impactLabel": ["fr"],
    "scrims.reportFocus": ["it"],
    "scrims.tags.fatigueMinus": ["fr"],
    "scrims.tags.fatiguePlus": ["fr"],
    "scrims.tags.mentalMinus": ["de", "es", "fr", "pt", "pt-BR"],
    "scrims.tags.mentalPlus": ["de", "es", "fr", "pt", "pt-BR"],
    "scrims.tags.momentumPlus": ["de"],
    "scrims.tags.riskMinus": ["tr"],
    "scrims.tags.techniqueMinus": ["fr"],
    "scrims.tags.volumeMinus": ["fr", "it", "pt", "pt-BR"],
    "scrims.tags.volumePlus": ["fr", "it", "pt", "pt-BR"],
    "training.scrims.planA": ["de", "es", "fr", "tr"],
    "training.scrims.planB": ["de", "es", "fr", "tr"],
    "training.scrims.planC": ["de", "es", "fr", "tr"],
    "training.scrims.slot": ["de", "it", "tr"],
  };

  it("translates every text the Scrims tab and its planning card show, in every locale", () => {
    const tagKeys = Object.values(DECISION_IMPACT_TAGS)
      .flat()
      .map((tag) => `scrims.tags.${tag}`);
    const keys = [
      ...new Set([
        ...["ScrimsTabV2.tsx", "ScrimPlanningCardV2.tsx", ...scrimDeskFiles()].flatMap(literalKeys),
        ...tagKeys,
      ]),
    ];
    // A key a component asks for must exist: the lookup below would otherwise skip it silently.
    expect(keys.filter((key) => lookup(LOCALES.en, key) === undefined)).toEqual([]);
    expect(keys.length).toBeGreaterThan(90);
    expectTranslated(keys, sameAsEnglishOk);
  });

  it("translates the slot statuses the strip and the plans table build from the game's status", () => {
    expectTranslated(["open", "locked", "played", "reviewed", "cancelled"].map((status) => `scrims.slotStatus.${status}`));
  });

  it("translates the risk levels, the focus impact texts and the other keys the tab builds or added", () => {
    expectTranslated(
      [
        "scrims.risk.high",
        "scrims.risk.medium",
        "scrims.risk.low",
        "scrims.cancelFollowupPrompt",
        "scrims.lossStreak",
        "training.scrims.autofill",
        ...["DraftPrep", "ChampionPool", "EarlyGame", "Teamfighting", "Macro", "Mental"].map(
          (focus) => `scrims.impact.${focus}`,
        ),
      ],
    );
  });

  it("keeps the sign of every impact tag, which states the direction of the change", () => {
    for (const [lang, tree] of Object.entries(LOCALES)) {
      const tags = (tree.scrims as Tree).tags as Record<string, string>;
      for (const [name, text] of Object.entries(tags)) {
        const sign = name.endsWith("Plus") ? "+" : "-";
        expect(text.startsWith(sign), `scrims.tags.${name} in ${lang}`).toBe(true);
        expect(text.includes(sign === "+" ? "-" : "+"), `scrims.tags.${name} in ${lang} has both signs`).toBe(false);
      }
    }
  });
});

describe("locale text integrity", () => {
  it("has no letter replaced by a question mark inside a word", () => {
    const broken: string[] = [];
    const walk = (node: string | Tree, path: string, lang: string) => {
      if (typeof node === "string") {
        if (/\p{L}\?\p{L}/u.test(node) && !/https?:|\?[\w]+=/.test(node)) broken.push(`${lang}:${path}`);
        return;
      }
      for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`, lang);
    };
    for (const [lang, tree] of Object.entries(LOCALES)) walk(tree, "", lang);
    expect(broken).toEqual([]);
  });

  it("has no Spanish question mark without its opening mark", () => {
    const broken: string[] = [];
    const walk = (node: string | Tree, path: string) => {
      if (typeof node === "string") {
        if (node.includes("?") && !node.includes("¿") && !/https?:/.test(node)) broken.push(path);
        return;
      }
      for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`);
    };
    walk(LOCALES.es, "es");
    expect(broken).toEqual([]);
  });
});
