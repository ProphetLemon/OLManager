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

/** Founding squad and rename namespaces, with the sources that must use every key. */
const NAMESPACES: Array<{ path: string[]; prefix: string; sources: string[] }> = [
  {
    path: ["teamSelect", "founders"],
    prefix: "teamSelect.founders",
    sources: [
      "../../ui-v2/pages/customTeam/CustomTeamWizardV2.tsx",
      "../../ui-v2/pages/customTeam/founders/FoundersStep.tsx",
      "../../ui-v2/pages/customTeam/founders/FounderEditDialog.tsx",
      "../../ui-v2/pages/customTeam/founders/FounderPhotoControl.tsx",
    ],
  },
  {
    path: ["playerProfile", "rename"],
    prefix: "playerProfile.rename",
    sources: [
      "../../ui-v2/pages/PlayerProfileV2.tsx",
      "../../ui-v2/pages/playerProfile/PlayerProfileHeroCardV2.tsx",
      "../../ui-v2/pages/playerProfile/PlayerProfileRenameModalV2.tsx",
    ],
  },
  {
    path: ["playerProfile", "photo"],
    prefix: "playerProfile.photo",
    sources: ["../../ui-v2/pages/playerProfile/PlayerProfilePhotoControlV2.tsx"],
  },
];

function leaves(tree: unknown, prefix = ""): Record<string, string> {
  if (typeof tree === "string") return { [prefix]: tree };
  if (!tree || typeof tree !== "object") return {};
  return Object.entries(tree as Tree).reduce<Record<string, string>>(
    (acc, [key, value]) => ({ ...acc, ...leaves(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

const subtree = (locale: Tree, path: string[]): Tree | undefined =>
  path.reduce<Tree | undefined>((node, key) => node?.[key] as Tree | undefined, locale);

const placeholders = (text: string): string[] =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

/** Keys a source uses: literal ones, and `prefix.${...}` template families. */
function usage(prefix: string, sources: string[]) {
  const literal = new Set<string>();
  const families: string[] = [];
  const escaped = prefix.replace(/\./g, "\\.");
  for (const relative of sources) {
    const source = readFileSync(resolve(__dirname, relative), "utf-8");
    for (const match of source.matchAll(new RegExp(`${escaped}\\.([A-Za-z.]+?)\\.\\$\\{`, "g"))) {
      families.push(match[1]);
    }
    for (const match of source.matchAll(new RegExp(`${escaped}\\.([A-Za-z][A-Za-z.]*[A-Za-z])`, "g"))) {
      literal.add(match[1]);
    }
  }
  return { literal, families };
}

describe.each(NAMESPACES)("$prefix locale keys", ({ path, prefix, sources }) => {
  const enKeys = leaves(subtree(en as Tree, path));
  const of = (locale: Tree) => leaves(subtree(locale, path));

  it("defines the strings in en.json", () => {
    expect(Object.keys(enKeys).length).toBeGreaterThan(8);
  });

  it.each(Object.keys(LOCALES))("%s has exactly the en.json key set", (code) => {
    expect(Object.keys(of(LOCALES[code])).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it.each(["en", ...Object.keys(LOCALES)])("%s has no empty strings", (code) => {
    const tree = code === "en" ? (en as Tree) : LOCALES[code];
    expect(Object.entries(of(tree)).filter(([, value]) => value.trim() === "")).toEqual([]);
  });

  it.each(Object.keys(LOCALES))("%s keeps the interpolation placeholders of en.json", (code) => {
    const values = of(LOCALES[code]);
    for (const [key, text] of Object.entries(enKeys)) {
      expect(placeholders(values[key]), `${code}: ${key}`).toEqual(placeholders(text));
    }
  });

  it.each(Object.keys(LOCALES))("%s translates the strings instead of copying English", (code) => {
    const values = of(LOCALES[code]);
    const copied = Object.entries(enKeys)
      .filter(([key, text]) => values[key] === text && /[a-z]{4,}/i.test(text.replace(/{{\w+}}/g, "")))
      .map(([key]) => key);
    expect(copied.length).toBeLessThanOrEqual(2);
  });

  it("uses every key defined in en.json and defines every key used", () => {
    const { literal, families } = usage(prefix, sources);
    // Plural forms are looked up through the base key (`action_one` is used as `action`).
    const base = (key: string) => key.replace(/_(one|other)$/, "");
    const covered = (key: string) =>
      literal.has(base(key)) || families.some((family) => key.startsWith(`${family}.`));
    expect(Object.keys(enKeys).filter((key) => !covered(key))).toEqual([]);
    const defined = new Set(Object.keys(enKeys).map(base));
    const unknown = [...literal].filter(
      (key) => !defined.has(key) && !Object.keys(enKeys).some((candidate) => candidate.startsWith(`${key}.`)),
    );
    expect(unknown).toEqual([]);
  });
});

describe("Rename button accessible name", () => {
  it.each(["en", ...Object.keys(LOCALES)])("%s: the aria-label contains the visible label (WCAG 2.5.3)", (code) => {
    const rename = ((code === "en" ? (en as Tree) : LOCALES[code]).playerProfile as Tree).rename as Tree;
    const visible = String(rename.action).trim().toLowerCase();
    const accessible = String(rename.actionAria).replace(/{{\s*nick\s*}}/g, "").toLowerCase();
    expect(accessible).toContain(visible);
  });
});
