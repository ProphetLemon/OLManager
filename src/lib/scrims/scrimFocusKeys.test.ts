import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import en from "@/i18n/locales/en.json";
import { SCRIM_FOCUS_IMPACT_KEYS, SCRIM_FOCUS_OBJECTIVE_KEYS } from "./scrimFocusKeys";

function backendFocuses(): string[] {
  const source = readFileSync(
    resolve(__dirname, "../../../src-tauri/crates/olm_core/src/domain/team.rs"),
    "utf-8",
  );
  const body = /pub enum ScrimFocus \{([^}]*)\}/.exec(source)?.[1] ?? "";
  return body
    .split(",")
    .map((variant) => variant.trim())
    .filter(Boolean);
}

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
}

describe("scrim focus texts", () => {
  it("reads the focus variants of the backend enum", () => {
    expect(backendFocuses()).toEqual(["DraftPrep", "ChampionPool", "EarlyGame", "Teamfighting", "Macro", "Mental"]);
  });

  it("has an impact text for every focus the backend can send", () => {
    for (const focus of backendFocuses()) {
      const key = (SCRIM_FOCUS_IMPACT_KEYS as Record<string, string>)[focus];
      expect(key, `impact key for ${focus}`).toBeTruthy();
      expect(typeof lookup(key), `${key} in en.json`).toBe("string");
    }
    expect(Object.keys(SCRIM_FOCUS_IMPACT_KEYS).sort()).toEqual([...backendFocuses()].sort());
  });

  it("has an objective label for every focus the backend can send", () => {
    for (const focus of backendFocuses()) {
      const key = (SCRIM_FOCUS_OBJECTIVE_KEYS as Record<string, string>)[focus];
      expect(key, `objective key for ${focus}`).toBeTruthy();
      expect(typeof lookup(key), `${key} in en.json`).toBe("string");
    }
  });
});
