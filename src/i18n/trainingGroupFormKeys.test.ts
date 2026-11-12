import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

type Tree = {
  common: { create: string };
  training: { groups: { newGroup: string; groupNamePlaceholder: string } };
};

const ENGLISH = en as unknown as Tree;
const OTHERS = Object.entries({ es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr } as unknown as Record<string, Tree>);

describe("add-group form texts", () => {
  it.each(OTHERS)("%s translates the form title, the name placeholder and the create button", (_name, tree) => {
    expect(tree.training.groups.newGroup).not.toBe(ENGLISH.training.groups.newGroup);
    expect(tree.training.groups.groupNamePlaceholder).not.toBe(ENGLISH.training.groups.groupNamePlaceholder);
    expect(tree.common.create).not.toBe(ENGLISH.common.create);
  });
});

describe("es condition label", () => {
  it("writes Energía with its accent", () => {
    expect(JSON.stringify(es)).not.toContain("Energia");
  });
});
