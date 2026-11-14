import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import de from "@/i18n/locales/de.json";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import fr from "@/i18n/locales/fr.json";
import itLocale from "@/i18n/locales/it.json";
import pt from "@/i18n/locales/pt.json";
import ptBR from "@/i18n/locales/pt-BR.json";
import tr from "@/i18n/locales/tr.json";
import { humanizeTraitId, traitDescKey, traitLabelKey } from "@/lib/playerProfile/traits";
import PlayerProfileTraitsCardV2 from "./PlayerProfileTraitsCardV2";

const LOCALE_FILES: Record<string, { traits: Record<string, unknown> }> = { en, es, de, fr, it: itLocale, pt, "pt-BR": ptBR, tr };
const LOCALES = ["en", "es", "de", "fr", "it", "pt", "pt-BR", "tr"];

/** Variant names of `PlayerTrait`, read from the Rust source so the two cannot drift. */
function rustTraitIds(): string[] {
  const src = readFileSync(
    resolve(process.cwd(), "src-tauri/crates/olm_core/src/domain/player.rs"),
    "utf8",
  );
  const body = /pub enum PlayerTrait \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
  return body
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => /^[A-Z][A-Za-z0-9]*,$/.test(line))
    .map((line) => line.slice(0, -1));
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("PlayerProfileTraitsCardV2", () => {
  it("shows the translated label for a known trait", () => {
    render(<PlayerProfileTraitsCardV2 title="Rasgos" traits={["LightningQuick"]} />);
    expect(screen.getByText("Rayo")).toBeInTheDocument();
    expect(screen.queryByText("LightningQuick")).toBeNull();
  });

  it("falls back to a readable label for an unknown trait", () => {
    render(<PlayerProfileTraitsCardV2 title="Rasgos" traits={["fast_learner", "ClutchGene"]} />);
    expect(screen.getByText("Fast learner")).toBeInTheDocument();
    expect(screen.getByText("Clutch gene")).toBeInTheDocument();
  });
});

describe("trait ids", () => {
  it("humanizes ids", () => {
    expect(humanizeTraitId("fast_learner")).toBe("Fast learner");
    expect(humanizeTraitId("HyperCarry")).toBe("Hyper carry");
  });

  it("reads a non-empty list of variants from the Rust enum", () => {
    expect(rustTraitIds().length).toBeGreaterThan(10);
  });

  it("has no trait keys beyond the Rust variants", () => {
    const ids = new Set(rustTraitIds());
    for (const [lng, bundle] of Object.entries(LOCALE_FILES)) {
      expect(Object.keys(bundle.traits).filter((id) => !ids.has(id)), lng).toEqual([]);
    }
  });

  it("covers every trait the backend can produce, in every locale", async () => {
    const ids = rustTraitIds();
    for (const lng of LOCALES) {
      const t = i18n.getFixedT(lng);
      for (const id of ids) {
        expect(i18n.exists(traitLabelKey(id), { lng }), `${lng}:${id}`).toBe(true);
        expect(t(traitLabelKey(id))).not.toBe(traitLabelKey(id));
        expect(i18n.exists(traitDescKey(id), { lng }), `${lng}:${id}:desc`).toBe(true);
      }
    }
  });
});
