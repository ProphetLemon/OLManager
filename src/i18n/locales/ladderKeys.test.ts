import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
  de: de as Tree,
  es: es as Tree,
  fr: fr as Tree,
  it: itLocale as Tree,
  pt: pt as Tree,
  "pt-BR": ptBR as Tree,
  tr: tr as Tree,
};

/** The promotion and relegation keys the backend writes into messages and news. */
const LADDER_KEYS = [
  "be.msg.ladder.promoted.subject",
  "be.msg.ladder.promoted.body",
  "be.msg.ladder.relegated.subject",
  "be.msg.ladder.relegated.body",
  "be.msg.ladder.leagueSwap.subject",
  "be.msg.ladder.leagueSwap.body",
  "be.news.ladder.headline",
  "be.news.ladder.body",
];

function valueAt(tree: Tree, path: string): string | undefined {
  let current: string | Tree | undefined = tree;
  for (const segment of path.split(".")) {
    if (!current || typeof current === "string") return undefined;
    current = current[segment];
  }
  return typeof current === "string" ? current : undefined;
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

describe("promotion and relegation locale keys", () => {
  it.each(["en", ...Object.keys(LOCALES)])("%s defines every key", (code) => {
    const tree = code === "en" ? (en as Tree) : LOCALES[code];
    const missing = LADDER_KEYS.filter((key) => !valueAt(tree, key)?.trim());
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(LOCALES))("%s keeps the interpolation placeholders of en.json", (code) => {
    for (const key of LADDER_KEYS) {
      const expected = placeholders(valueAt(en as Tree, key) ?? "");
      expect(placeholders(valueAt(LOCALES[code], key) ?? ""), `${code}: ${key}`).toEqual(expected);
    }
  });

  it.each(Object.keys(LOCALES))("%s translates the strings instead of copying English", (code) => {
    const copied = LADDER_KEYS.filter((key) => valueAt(LOCALES[code], key) === valueAt(en as Tree, key));
    expect(copied).toEqual([]);
  });

  it("matches the keys the Rust reporter emits", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../src-tauri/crates/olm_core/src/ladder_report.rs"),
      "utf-8",
    );
    const emitted = [...source.matchAll(/"(be\.(?:msg|news)\.ladder\.[A-Za-z.]+)"/g)].map((m) => m[1]);
    expect([...new Set(emitted)].sort()).toEqual([...LADDER_KEYS].sort());
  });
});
