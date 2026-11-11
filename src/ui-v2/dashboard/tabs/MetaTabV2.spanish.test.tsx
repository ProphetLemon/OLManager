import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { MetaTabV2 } from "./MetaTabV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const ENGLISH_TEXTS = [
  /Patch Meta/i,
  /\bdiscovery\b/i,
  /\bmastery\b/i,
  /Updated/,
  /Discovery Stats/i,
  /\d+% Complete/i,
  /\d+ discovered/i,
  /Assistant Coach/i,
  /Champion Mastery Training/i,
  /No target/i,
  /\bJungle\b/,
  /\bSupport\b/,
];

function buildState(): GameStateData {
  return {
    clock: { current_date: "2027-01-20T00:00:00Z", start_date: "2027-01-01T00:00:00Z" },
    manager: { id: "m1", team_id: "t1" },
    teams: [{ id: "t1", name: "Alpha", short_name: "ALP", competition_id: "lec" }],
    players: [
      {
        id: "p1",
        team_id: "t1",
        match_name: "Zed",
        full_name: "Zed Smith",
        champion_training_targets: [],
      },
    ],
    staff: [],
    champions: [{ champion_key: "Ahri" }, { champion_key: "Zed" }],
    champion_patch: {
      current_patch_label: "14.1",
      last_patch_date: "2027-01-19",
      hidden_meta: [{ champion_id: "Ahri", role: "Mid", tier: "S" }],
      discovered_champion_ids: ["Ahri"],
    },
  } as unknown as GameStateData;
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("MetaTabV2 in the Spanish UI", () => {
  it("writes every label, counter and date in Spanish", () => {
    const { container } = render(<MetaTabV2 gameState={buildState()} onViewChampion={vi.fn()} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Meta del parche");
    expect(text).toContain("50% completado");
    expect(text).toContain("1 descubierto");
    expect(text).toContain("Delegar al entrenador asistente");
    expect(text).toContain("Sin objetivo");
    for (const pattern of ENGLISH_TEXTS) {
      expect(text, String(pattern)).not.toMatch(pattern);
    }
  });

  it("writes the patch date with the app's Spanish date format, not as an ISO string", () => {
    const { container } = render(<MetaTabV2 gameState={buildState()} onViewChampion={vi.fn()} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Actualizado");
    expect(text).toContain("19 de enero de 2027");
    expect(text).not.toContain("2027-01-19");
  });

  it("writes the staff effects and the role names in Spanish", () => {
    const { container } = render(<MetaTabV2 gameState={buildState()} onViewChampion={vi.fn()} />);
    const text = container.textContent ?? "";

    expect(text).toMatch(/de descubrimiento/);
    expect(text).toMatch(/de maestría/);
    const roleLabels = [...container.querySelectorAll("button[title]")].map((node) => node.getAttribute("title"));
    expect(roleLabels).toContain("Jungla");
  });

  // jsdom has no layout, so the collapse is pinned through the class contract. The page is a
  // fixed-height flex column that scrolls; a card there with `flex-1 min-h-0` has a flex basis of
  // zero and shrinks below its content, so the next card is drawn over its list.
  it("lets the discovery and mastery cards keep the height of their content", () => {
    const { container, getByText } = render(<MetaTabV2 gameState={buildState()} onViewChampion={vi.fn()} />);
    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveClass("overflow-y-auto");

    for (const title of [i18n.t("meta.discoveryStats"), i18n.t("champions.masteryTrainingTitle")]) {
      const card = getByText(title).closest('[data-slot="card"]') as HTMLElement;
      expect(card.parentElement).toBe(page);
      expect(card, title).toHaveClass("shrink-0");
      expect(card, title).not.toHaveClass("flex-1");
      expect(card, title).not.toHaveClass("min-h-0");
      const content = card.querySelector('[data-slot="card-content"]') as HTMLElement;
      expect(content, title).not.toHaveClass("flex-1");
      expect(content, title).not.toHaveClass("min-h-0");
    }
  });
});
