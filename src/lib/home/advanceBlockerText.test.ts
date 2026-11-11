import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { SCRIM_BLOCKER_IDS } from "./blockerRules";
import { backendBlockerText, WORDED_BLOCKER_IDS } from "./advanceBlockerText";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("backendBlockerText", () => {
  it("words the urgent-message blocker from its count", () => {
    expect(backendBlockerText({ id: "urgent_messages", params: { count: 1 } })).toBe("1 urgent unread message");
    expect(backendBlockerText({ id: "urgent_messages", params: { count: 2 } })).toBe("2 urgent unread messages");
  });

  it("words the urgent-message blocker in Spanish, matching the Home card", async () => {
    await i18n.changeLanguage("es");
    expect(backendBlockerText({ id: "urgent_messages", params: { count: 1 } })).toBe("1 mensaje urgente sin leer");
    expect(backendBlockerText({ id: "urgent_messages", params: { count: 3 } })).toBe("3 mensajes urgentes sin leer");
  });

  it("words every roster and contract blocker from its params", () => {
    expect(
      backendBlockerText({ id: "incomplete_lineup", params: { reason: "too_few", selected: 3, required: 5 } }),
    ).toContain("only 3 of the 5");
    expect(
      backendBlockerText({ id: "incomplete_lineup", params: { reason: "missing_roles", roles: "MID", count: 1 } }),
    ).toContain("missing the role Mid");
    expect(
      backendBlockerText({ id: "incomplete_lineup", params: { reason: "missing_roles", roles: "MID, ADC", count: 2 } }),
    ).toContain("missing the roles Mid, ADC");
    expect(backendBlockerText({ id: "key_contract_risk", params: { players: "Ana, Bo" } })).toContain("Ana, Bo");
    expect(backendBlockerText({ id: "contract_wage_risk", params: { amount: 60000 } })).toContain("60000");
    expect(backendBlockerText({ id: "main_roster_minimum", params: { count: 4 } })).toContain("you have 4 players");
    expect(backendBlockerText({ id: "main_missing_roles", params: { roles: "TOP" } })).toContain("missing in Top");
    expect(backendBlockerText({ id: "academy_missing_roles", params: { roles: "SUPPORT" } })).toContain(
      "missing in Support",
    );
  });

  it("writes the missing roles and the role list with the translated role names", async () => {
    await i18n.changeLanguage("es");
    const lineup = backendBlockerText({
      id: "incomplete_lineup",
      params: { reason: "missing_roles", roles: "JUNGLE, SUPPORT", count: 2 },
    });
    expect(lineup).toBe(
      "A tu alineación le faltan los roles Jungla, Support. Asegúrate de tener Top, Jungla, Mid, ADC y Support.",
    );
    const main = backendBlockerText({ id: "main_missing_roles", params: { roles: "JUNGLE" } });
    expect(main).toContain("falta al menos un jugador en Jungla.");
    expect(main).toContain("hasta cubrir Top, Jungla, Mid, ADC y Support");
    for (const text of [lineup, main]) {
      expect(text).not.toMatch(/JUNGLE|TOP|SUPPORT/);
    }
  });

  it("returns null when the params are missing or unusable, so the backend text stays", () => {
    expect(backendBlockerText({ id: "urgent_messages" })).toBeNull();
    expect(backendBlockerText({ id: "urgent_messages", params: { count: "2" } })).toBeNull();
    expect(backendBlockerText({ id: "incomplete_lineup", params: { reason: "other" } })).toBeNull();
    expect(backendBlockerText({ id: "unknown_blocker", params: { count: 1 } })).toBeNull();
  });

  it("words every blocker id the backend can raise, so a new id without a text fails here", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../src-tauri/crates/olm_core/src/time_blockers.rs"),
      "utf-8",
    );
    const raised = [...source.matchAll(/^\s*"([a-z_]+)",\s*\n\s*"(?:warn|info)",/gm)].map((match) => match[1]);
    expect(raised.length).toBeGreaterThanOrEqual(7);
    const covered = new Set([...WORDED_BLOCKER_IDS, ...SCRIM_BLOCKER_IDS]);
    expect(raised.filter((id) => !covered.has(id))).toEqual([]);
  });
});
