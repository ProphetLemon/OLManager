import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  DraftSlot,
  isOffRole,
  OffRoleNotice,
} from "@/ui-v2/_legacy/components/match/ChampionDraft";
import de from "@/i18n/locales/de.json";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import fr from "@/i18n/locales/fr.json";
import itLocale from "@/i18n/locales/it.json";
import ptBR from "@/i18n/locales/pt-BR.json";
import pt from "@/i18n/locales/pt.json";
import tr from "@/i18n/locales/tr.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}|${Object.values(options).join("|")}` : key,
  }),
}));

const AHRI = { id: "Ahri", key: 103, name: "Ahri", image: "/ahri.png", tags: ["Mage"], roleHints: ["MID" as const] };

function slot(role: "JUNGLE" | "MID", showSwapControls: boolean) {
  return (
    <DraftSlot
      side="blue"
      playerName="P"
      role={role}
      pick={{ role, championId: "Ahri" }}
      championById={new Map([["Ahri", AHRI]])}
      showSwapControls={showSwapControls}
      onSwapArm={() => {}}
      onSwapTarget={() => {}}
      swapArmed={false}
      swapTargetable={false}
      reorderFxActive={false}
    />
  );
}

afterEach(cleanup);

describe("off-role detection", () => {
  it("flags a champion placed in a role it does not have", () => {
    expect(isOffRole(["MID"], "JUNGLE")).toBe(true);
  });

  it("does not flag a champion in one of its roles or a champion without role data", () => {
    expect(isOffRole(["MID", "TOP"], "TOP")).toBe(false);
    expect(isOffRole([], "JUNGLE")).toBe(false);
  });
});

describe("OffRoleNotice", () => {
  it("announces the message through a polite status region", () => {
    render(<OffRoleNotice message="careful" />);
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toContain("careful");
  });

  it("keeps an empty status region mounted when there is nothing to say", () => {
    render(<OffRoleNotice message={null} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("DraftSlot off-role warning", () => {
  it("warns when the final assignment or a swap puts a champion in a role it lacks", () => {
    render(slot("JUNGLE", true));
    expect(screen.getByRole("status").textContent).toContain("match.draft.offRoleWarning|Ahri|JUNGLE");
  });

  it("shows no warning once a swap puts the champion back in its role", () => {
    render(slot("MID", true));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows no warning before the draft is final", () => {
    render(slot("JUNGLE", false));
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("off-role warning locale keys", () => {
  const locales: Record<string, unknown> = { de, en, es, fr, it: itLocale, "pt-BR": ptBR, pt, tr };
  const draft = (locale: unknown) =>
    (locale as { match: { draft: Record<string, string> } }).match.draft;

  for (const [name, locale] of Object.entries(locales)) {
    it(`${name} translates both warnings with their placeholders`, () => {
      expect(draft(locale).offRoleWarning).toContain("{{champion}}");
      expect(draft(locale).offRoleWarning).toContain("{{role}}");
      expect(draft(locale).offRolePickWarning).toContain("{{champion}}");
    });
  }

  it("does not reuse the English text in other locales", () => {
    for (const [name, locale] of Object.entries(locales)) {
      if (name === "en") continue;
      expect(draft(locale).offRoleWarning, name).not.toBe(draft(en).offRoleWarning);
      expect(draft(locale).offRolePickWarning, name).not.toBe(draft(en).offRolePickWarning);
    }
  });
});
