import { describe, expect, it } from "vitest";

import en from "./en.json";
import ptBR from "./pt-BR.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out[`${prefix}${key}`] = value;
    else Object.assign(out, flatten(value, `${prefix}${key}.`));
  }
  return out;
}

// Values that are the same word in Portuguese: game terms, brand names, league names.
const SAME_AS_ENGLISH = new Set([
  "dashboard.scrims",
  "dashboard.soloq",
  "dashboard.meta",
  "dashboard.social",
  "dashboard.scouting",
  "dashboard.worldStaff",
  "dashboard.brandSubtitle",
  "dashboard.brandTitle",
  "dashboard.phaseLabels.scrimBlock",
  "sidebar.bundesliga",
  "sidebar.leaguesInsider",
  "sidebar.ligue1",
  "sidebar.premier",
  "sidebar.serieA",
  "sidebar.usernamePlaceholder",
]);

describe("pt-BR navigation, dashboard and inbox labels", () => {
  const english = flatten(en as Tree);
  const portuguese = flatten(ptBR as Tree);

  it("does not leave English text in the dashboard, inbox and sidebar sections", () => {
    const untranslated = Object.keys(portuguese).filter(
      (key) =>
        /^(dashboard|inbox|sidebar)\./.test(key) &&
        !SAME_AS_ENGLISH.has(key) &&
        portuguese[key] === english[key],
    );
    expect(untranslated).toEqual([]);
  });

  it("names the youth academy in Portuguese", () => {
    expect(portuguese["dashboard.youthAcademy"]).toBe("Academia");
  });
});
