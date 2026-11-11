import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { newScrimResultLines } from "@/hooks/scrimResultNotice";
import type { GameStateData } from "@/store/gameStore";

import { ScrimResultNoticeV2 } from "./ScrimResultNoticeV2";

// Real locale files, no default values: the plural keys must resolve on their own.

function gameWithScrims(results: Array<{ rival: string; won: boolean }>): GameStateData {
  return {
    manager: { team_id: "mine" },
    teams: [
      {
        id: "mine",
        name: "Mine",
        scrim_reports: results.map((r, index) => ({
          week_key: "2027-W01",
          slot_index: index,
          opponent_team_id: `rival-${index}`,
          won: r.won,
        })),
      },
      ...results.map((r, index) => ({ id: `rival-${index}`, name: r.rival, scrim_reports: [] })),
    ],
  } as unknown as GameStateData;
}

async function renderNotice(language: "en" | "es", results: Array<{ rival: string; won: boolean }>) {
  await i18n.changeLanguage(language);
  const lines = newScrimResultLines(new Set(), gameWithScrims(results));
  render(<ScrimResultNoticeV2 lines={lines} assistantNote={null} onOpenScrims={vi.fn()} onDismiss={vi.fn()} />);
  return lines;
}

describe("ScrimResultNoticeV2 with the real locale files", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("uses the English singular title and names the rival for one scrim", async () => {
    await renderNotice("en", [{ rival: "Rivals", won: true }]);

    const region = screen.getByRole("region", { name: "Scrim result" });
    expect(region).toHaveTextContent("Won against Rivals");
    expect(screen.getByRole("button", { name: "Open Scrims" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("uses the English plural title and names each rival for two scrims", async () => {
    await renderNotice("en", [
      { rival: "Rivals", won: true },
      { rival: "Others", won: false },
    ]);

    const region = screen.getByRole("region", { name: "Scrim results" });
    expect(region).toHaveTextContent("Won against Rivals");
    expect(region).toHaveTextContent("Lost against Others");
  });

  it("uses the Spanish singular title and names the rival for one scrim", async () => {
    await renderNotice("es", [{ rival: "Rivales", won: false }]);

    const region = screen.getByRole("region", { name: "Resultado del scrim" });
    expect(region).toHaveTextContent("Derrota contra Rivales");
    expect(screen.getByRole("button", { name: "Abrir Scrims" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("uses the Spanish plural title and names each rival for two scrims", async () => {
    await renderNotice("es", [
      { rival: "Rivales", won: true },
      { rival: "Otros", won: false },
    ]);

    const region = screen.getByRole("region", { name: "Resultados de los scrims" });
    expect(region).toHaveTextContent("Victoria contra Rivales");
    expect(region).toHaveTextContent("Derrota contra Otros");
  });
});
