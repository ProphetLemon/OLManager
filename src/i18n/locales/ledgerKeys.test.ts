import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type Ledger = Record<string, string | Record<string, string>>;
const ledgerOf = (locale: unknown): Ledger => (locale as { be: { ledger: Ledger } }).be.ledger;

const OTHERS: Record<string, unknown> = { de, es, fr, it: itLocale, "pt-BR": ptBR, pt, tr };
const PLACEHOLDER = /\{\{\s*\w+\s*\}\}/g;
// Texts that are the same word in some languages (a loanword or a cognate).
const MAY_MATCH_ENGLISH = new Set(["facilityTypes", "academyAcquisition", "facilityUpgrade"]);

const placeholders = (text: string): string[] => [...(text.match(PLACEHOLDER) ?? [])].sort();

describe("ledger line texts written by the backend", () => {
  it("English has a text for every key the ledger writers use", () => {
    expect(Object.keys(ledgerOf(en)).sort()).toEqual(
      [
        "academyAcquisition",
        "contractTermination",
        "facilityTypes",
        "facilityUpgrade",
        "facilityUpkeep",
        "freeAgentSigning",
        "mainHubExpansion",
        "matchdayRevenue",
        "moduleUpgrade",
        "playerWages",
        "promotionFunding",
        "seasonPrize",
        "sponsorshipIncome",
        "staffHiring",
        "staffWages",
        "transferPurchase",
        "transferSale",
      ].sort(),
    );
    expect(Object.keys(ledgerOf(en).facilityTypes).sort()).toEqual(["Medical", "Scouting", "Training"]);
  });

  it.each(Object.entries(OTHERS))("%s translates every ledger text and keeps its placeholders", (_lang, locale) => {
    const english = ledgerOf(en);
    const ledger = ledgerOf(locale);

    expect(Object.keys(ledger).sort()).toEqual(Object.keys(english).sort());
    for (const [key, source] of Object.entries(english)) {
      const translated = ledger[key];
      if (typeof source === "string") {
        expect(translated, key).toBeTruthy();
        if (!MAY_MATCH_ENGLISH.has(key)) expect(translated, key).not.toBe(source);
        expect(placeholders(translated as string), key).toEqual(placeholders(source));
      } else {
        expect(Object.keys(translated as Record<string, string>).sort(), key).toEqual(Object.keys(source).sort());
      }
    }
  });
});
