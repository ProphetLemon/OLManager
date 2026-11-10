import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf-8");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "pt-BR", "tr"] as const;

/** Every blocker id the app can put on Home: the backend ones and the two the advance hook raises. */
function raisedBlockerIds(): string[] {
  const core = read("src-tauri/crates/olm_core/src/time_blockers.rs");
  const scrims = read("src-tauri/src/application/advance_blockers.rs");
  const hook = read("src/hooks/useAdvanceTime.ts");
  const ids = [
    ...[...core.matchAll(/^\s*"([a-z_]+)",\s*\n\s*"(?:warn|info)",/gm)].map((m) => m[1]),
    ...[...scrims.matchAll(/Self::\w+ => \(\s*"([a-z_]+)",/g)].map((m) => m[1]),
    ...[...hook.matchAll(/\bid: "([a-z_]+)"/g)].map((m) => m[1]),
  ];
  return [...new Set(ids)];
}

describe("blocker consequence texts", () => {
  it("finds the ids the backend and the advance hook can raise", () => {
    expect(raisedBlockerIds()).toEqual(
      expect.arrayContaining([
        "incomplete_lineup",
        "urgent_messages",
        "academy_missing_roles",
        "scrim_setup_required",
        "scrim_decision_required",
        "advance_blocked",
        "assistant_advance_limit",
      ]),
    );
  });

  it.each(LOCALES)("gives every raised blocker id its own consequence in %s", (locale) => {
    const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    const consequence = messages.onAir.calls.consequence as Record<string, unknown>;
    const missing = raisedBlockerIds().filter(
      (id) => typeof consequence[id] !== "string" || (consequence[id] as string).trim() === "",
    );
    expect(missing).toEqual([]);
  });

  it.each(LOCALES.filter((locale) => locale !== "en"))("translates the new keys in %s", (locale) => {
    const en = JSON.parse(read("src/i18n/locales/en.json")).onAir.calls;
    const other = JSON.parse(read(`src/i18n/locales/${locale}.json`)).onAir.calls;
    for (const id of ["advance_blocked", "assistant_advance_limit"]) {
      expect(other.consequence[id]).not.toBe(en.consequence[id]);
    }
    expect(other.actions.openAcademy).not.toBe(en.actions.openAcademy);
  });
});
