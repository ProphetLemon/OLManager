import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EndOfSeasonSummaryData, LadderMovementReportData } from "@/store/types";

import { PromotionRelegationCard } from "./PromotionRelegationCard";

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return { useTranslation: () => ({ t: translateFromEnglish }) };
});

const TEAMS = [
  { id: "t-up", name: "Rising Fox", logo_url: "/teams-icons/risingfox.webp" },
  { id: "t-down", name: "Fallen Owl", logo_url: null },
  { id: "t-user", name: "Mine Esports", logo_url: null },
];
const LEAGUES = [
  { competition_id: "lec", logo: "/leagues/lec.webp" },
  { competition_id: "les", logo: null },
];

const MOVEMENT: LadderMovementReportData = {
  lower_competition_id: "les",
  lower_competition_name: "LES",
  upper_competition_id: "lec",
  upper_competition_name: "LEC",
  season: 2026,
  status: "Applied",
  promoted: [{ id: "t-up", name: "Rising Fox" }],
  relegated: [{ id: "t-down", name: "Fallen Owl" }],
};

type LadderSummary = Pick<EndOfSeasonSummaryData, "ladder_movements" | "user_ladder">;

function summary(overrides: Partial<LadderSummary> = {}): LadderSummary {
  return { ladder_movements: [MOVEMENT], user_ladder: null, ...overrides };
}

function renderCard(s: LadderSummary) {
  return render(
    <PromotionRelegationCard summary={s} teams={TEAMS} leagues={LEAGUES} userTeamId="t-user" />,
  );
}

describe("PromotionRelegationCard", () => {
  it("renders nothing when the season produced no movement", () => {
    const { container } = renderCard(summary({ ladder_movements: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it("announces a promoted user club with the new league", () => {
    renderCard(
      summary({
        user_ladder: { result: "Promoted", from_competition_id: "les", to_competition_id: "lec" },
      }),
    );
    const result = screen.getByTestId("ladder-user-result");
    expect(within(result).getByText("Promoted")).toBeInTheDocument();
    expect(
      within(result).getByText("Mine Esports moves up to LEC for the next season."),
    ).toBeInTheDocument();
    expect(result.querySelector('img[src$="/leagues/lec.webp"]')).not.toBeNull();
  });

  it("announces a relegated user club in words, not only colour", () => {
    renderCard(
      summary({
        user_ladder: { result: "Relegated", from_competition_id: "lec", to_competition_id: "les" },
      }),
    );
    const result = screen.getByTestId("ladder-user-result");
    expect(within(result).getByText("Relegated")).toBeInTheDocument();
    expect(
      within(result).getByText("Mine Esports drops down to LES for the next season."),
    ).toBeInTheDocument();
  });

  it("lists an AI-only swap without a user result", () => {
    renderCard(summary());
    expect(screen.queryByTestId("ladder-user-result")).toBeNull();
    expect(screen.getByText("Rising Fox")).toBeInTheDocument();
    expect(screen.getByText("Fallen Owl")).toBeInTheDocument();
    expect(screen.getByText("Promoted to LEC")).toBeInTheDocument();
    expect(screen.getByText("Relegated to LES")).toBeInTheDocument();
  });

  it("explains a stayed club and a movement that was not applied", () => {
    renderCard(
      summary({
        ladder_movements: [{ ...MOVEMENT, status: "SkippedLate", promoted: [], relegated: [] }],
        user_ladder: { result: "Stayed", from_competition_id: "lec", to_competition_id: "lec" },
      }),
    );
    expect(
      screen.getByText("Mine Esports stays in LEC. Other clubs changed league."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not applied: the lower league had not finished its season."),
    ).toBeInTheDocument();
  });

  it("exposes a named region, headings and list semantics", () => {
    renderCard(summary());
    const region = screen.getByRole("region", { name: "Promotion and relegation" });
    expect(within(region).getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(
      within(region).getByRole("heading", { level: 3, name: "League movements" }),
    ).toBeInTheDocument();
    expect(within(region).getAllByRole("list").length).toBeGreaterThan(1);
    expect(within(region).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
  });

  it("does not expose decorative logos to assistive technology", () => {
    const { container } = renderCard(summary());
    for (const img of container.querySelectorAll("img")) {
      expect(img.getAttribute("alt")).toBe("");
    }
  });
});
