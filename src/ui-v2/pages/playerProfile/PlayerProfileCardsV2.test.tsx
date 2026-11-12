import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CareerEntry, GameStateData, PlayerMatchHistoryEntryData } from "@/store/gameStore";
import PlayerProfileCareerCardV2 from "./PlayerProfileCareerCardV2";
import PlayerProfileChampionsCardV2 from "./PlayerProfileChampionsCardV2";
import PlayerProfileContractActionsV2 from "./PlayerProfileContractActionsV2";
import PlayerProfileContractCardV2 from "./PlayerProfileContractCardV2";
import PlayerProfileMatchHistoryCardV2 from "./PlayerProfileMatchHistoryCardV2";
import PlayerProfileScoutActionV2 from "./PlayerProfileScoutActionV2";
import PlayerProfileStatsCardV2 from "./PlayerProfileStatsCardV2";
import PlayerProfileTraitsCardV2 from "./PlayerProfileTraitsCardV2";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const t = (key: string, options?: Record<string, string | number>) =>
  options?.count !== undefined ? `${key}:${options.count}` : key;

describe("PlayerProfileChampionsCardV2", () => {
  it("hides games and win rate when the champion has no games", () => {
    render(
      <PlayerProfileChampionsCardV2
        champions={[
          { championId: "Ahri", championName: "Ahri", mastery: 90, rank: "insignia", wr: 0, games: 0 },
        ]}
      />,
    );
    expect(screen.queryByText(/0\.0%/)).toBeNull();
    expect(screen.queryByText("playerProfile.championGames")).toBeNull();
  });

  it("shows win rate and games, and reports the clicked champion", () => {
    const onViewChampion = vi.fn();
    render(
      <PlayerProfileChampionsCardV2
        champions={[
          { championId: "Ahri", championName: "Ahri", mastery: 90, rank: "insignia", wr: 60, games: 5 },
          { championId: "Zed", championName: "Zed", mastery: 70, rank: 1, wr: 40, games: 3 },
        ]}
        onViewChampion={onViewChampion}
      />,
    );
    expect(screen.getByText(/60\.0%/)).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Zed/ }));
    expect(onViewChampion).toHaveBeenCalledWith("Zed");
  });
});

describe("PlayerProfileStatsCardV2", () => {
  it("shows the empty message when no games were played", () => {
    render(<PlayerProfileStatsCardV2 stats={{ games_played: 0 } as never} t={t} />);
    expect(screen.getByText("playerProfile.noStats")).toBeInTheDocument();
  });

  it("computes KDA from kills, assists and deaths", () => {
    render(
      <PlayerProfileStatsCardV2
        stats={{ games_played: 4, wins: 3, losses: 1, kills: 10, assists: 20, deaths: 5, cs: 900, vision_score: 40 } as never}
        t={t}
      />,
    );
    expect(screen.getByText("6.0")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
  });

  it("shows the season numbers the backend records (appearances, kills, assists)", () => {
    render(<PlayerProfileStatsCardV2 stats={{ appearances: 4, kills: 12, assists: 30 } as never} t={t} />);
    expect(screen.queryByText("playerProfile.noStats")).toBeNull();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows wins, losses, KDA, CS and vision from the season totals of the match records", () => {
    render(
      <PlayerProfileStatsCardV2
        stats={{ appearances: 3, kills: 8, assists: 19 } as never}
        totals={{ wins: 2, losses: 1, kills: 8, deaths: 5, assists: 19, cs: 830, vision: 120 }}
        t={t}
      />,
    );
    expect(screen.getByText("common.wins").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("common.losses").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("KDA").nextSibling).toHaveTextContent("5.4");
    expect(screen.getByText("CS").nextSibling).toHaveTextContent("830");
    expect(screen.getByText("common.vision").nextSibling).toHaveTextContent("120");
  });

  it("leaves the vision tile out when the match records hold no vision score", () => {
    render(
      <PlayerProfileStatsCardV2
        stats={{ appearances: 5, kills: 8, assists: 19 } as never}
        totals={{ wins: 3, losses: 2, kills: 8, deaths: 5, assists: 19, cs: 830, vision: 0 }}
        t={t}
      />,
    );
    expect(screen.getByText("CS").nextSibling).toHaveTextContent("830");
    expect(screen.queryByText("common.vision")).toBeNull();
  });

  it("leaves out numbers the season stats do not carry instead of showing zeros", () => {
    render(<PlayerProfileStatsCardV2 stats={{ appearances: 4, kills: 12, assists: 30 } as never} t={t} />);
    expect(screen.queryByText("common.wins")).toBeNull();
    expect(screen.queryByText("common.losses")).toBeNull();
    expect(screen.queryByText("KDA")).toBeNull();
    expect(screen.queryByText("CS")).toBeNull();
    expect(screen.queryByText("common.vision")).toBeNull();
  });
});

const career = (season: number, team = `Team ${season}`): CareerEntry =>
  ({ season, team_id: `t-${season}`, team_name: team, appearances: 10, kills: 5, assists: 7, avg_rating: 7.25 }) as never;

describe("PlayerProfileCareerCardV2", () => {
  const gameState = { teams: [{ id: "t-5", name: "Renamed FC" }] } as unknown as GameStateData;

  it("shows the latest three seasons first and expands on request", () => {
    render(
      <PlayerProfileCareerCardV2
        career={[career(1), career(2), career(3), career(4), career(5)]}
        gameState={gameState}
        t={t}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("Renamed FC")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /common\.showMore/ }));
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });

  it("renders nothing for an empty career", () => {
    const { container } = render(<PlayerProfileCareerCardV2 career={[]} gameState={gameState} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PlayerProfileMatchHistoryCardV2", () => {
  const entries = Array.from({ length: 12 }, (_, idx) => ({
    fixtureId: `f-${idx}`,
    date: `2026-08-${String(idx + 1).padStart(2, "0")}`,
    opponentName: `Opp ${idx}`,
    result: idx % 2 === 0 ? "Win" : "Loss",
    kills: 1,
    deaths: 2,
    assists: 3,
    championId: null,
  })) as unknown as PlayerMatchHistoryEntryData[];

  it("lists the newest ten matches and expands to all", () => {
    render(<PlayerProfileMatchHistoryCardV2 history={entries} t={t} language="en" />);
    expect(screen.getByText("playerProfile.vs Opp 11")).toBeInTheDocument();
    expect(screen.queryByText("playerProfile.vs Opp 0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /common\.showMore/ }));
    expect(screen.getByText("playerProfile.vs Opp 0")).toBeInTheDocument();
  });

  it("names the champion played in the row when the entry carries it", () => {
    const withChampion = [{ ...entries[0], championId: "Malphite" }] as unknown as PlayerMatchHistoryEntryData[];
    render(<PlayerProfileMatchHistoryCardV2 history={withChampion} t={t} language="en" />);
    expect(screen.getByText(/Malphite/)).toBeInTheDocument();
  });
});

describe("PlayerProfileContractCardV2", () => {
  const base = {
    dateOfBirth: "2000-01-01",
    contractEnd: "2026-10-15",
    currentDate: "2026-08-01T00:00:00Z",
    condition: 80,
    fitness: 70,
    morale: 60,
    marketValue: 350000,
    wage: 12000,
    annualSuffix: "/yr",
    language: "en",
    contractRiskLevel: "critical" as const,
    contractRiskLabel: "Critical",
    t,
  };

  it("shows the contract facts and leaves the actions to the hero", () => {
    render(<PlayerProfileContractCardV2 {...base} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "common.condition" })).toHaveAttribute("aria-valuenow", "80");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides years remaining, risk badge and wage for a player without contract", () => {
    render(<PlayerProfileContractCardV2 {...base} contractEnd={null} />);
    expect(screen.getByText("playerProfile.noContract")).toBeInTheDocument();
    expect(screen.queryByText("playerProfile.yearsRemaining")).toBeNull();
    expect(screen.queryByText("playerProfile.contractRisk")).toBeNull();
    expect(screen.queryByText("Critical")).toBeNull();
    expect(screen.queryByText("playerProfile.annualWage")).toBeNull();
  });

  it("hides contract rows for a player without a team even with a stale contract end", () => {
    render(<PlayerProfileContractCardV2 {...base} hasTeam={false} />);
    expect(screen.queryByText("playerProfile.yearsRemaining")).toBeNull();
    expect(screen.queryByText("playerProfile.annualWage")).toBeNull();
  });
});

describe("PlayerProfileContractActionsV2", () => {
  const base = {
    isOwnClub: true,
    isTransferWindowOpen: true,
    transferActionSubmitting: false,
    onOpenRenewal: vi.fn(),
    onReleaseContract: vi.fn(),
    onOpenTransferBid: vi.fn(),
    t,
  };

  it("offers renewal and release for the own club during the window", () => {
    const onOpenRenewal = vi.fn();
    const onReleaseContract = vi.fn();
    render(<PlayerProfileContractActionsV2 {...base} onOpenRenewal={onOpenRenewal} onReleaseContract={onReleaseContract} />);
    fireEvent.click(screen.getByRole("button", { name: "common.renewContract" }));
    fireEvent.click(screen.getByRole("button", { name: "playerProfile.releaseContract" }));
    expect(onOpenRenewal).toHaveBeenCalled();
    expect(onReleaseContract).toHaveBeenCalled();
  });

  it("hides release outside the transfer window", () => {
    render(<PlayerProfileContractActionsV2 {...base} isTransferWindowOpen={false} />);
    expect(screen.getByRole("button", { name: "common.renewContract" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "playerProfile.releaseContract" })).toBeNull();
  });

  it("offers a transfer bid for other clubs only while the window is open", () => {
    const onOpenTransferBid = vi.fn();
    const { rerender } = render(
      <PlayerProfileContractActionsV2 {...base} isOwnClub={false} onOpenTransferBid={onOpenTransferBid} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "playerProfile.makeTransferOffer" }));
    expect(onOpenTransferBid).toHaveBeenCalled();
    rerender(<PlayerProfileContractActionsV2 {...base} isOwnClub={false} isTransferWindowOpen={false} />);
    expect(screen.queryByRole("button", { name: "playerProfile.makeTransferOffer" })).toBeNull();
  });
});

describe("PlayerProfileTraitsCardV2", () => {
  it("renders every trait", () => {
    render(<PlayerProfileTraitsCardV2 title="Traits" traits={["Leader", "Clutch"]} />);
    expect(screen.getByText("Leader")).toBeInTheDocument();
    expect(screen.getByText("Clutch")).toBeInTheDocument();
  });
});

describe("PlayerProfileScoutActionV2", () => {
  const availability = (overrides = {}) =>
    ({ scouts: [{ id: "s1" }], availableScout: { id: "s1" }, canScout: true, alreadyScouting: false, ...overrides }) as never;

  it("shows a hint when there are no scouts", () => {
    render(
      <PlayerProfileScoutActionV2 availability={availability({ scouts: [] })} scoutStatus="idle" scoutError={null} onScout={vi.fn()} />,
    );
    expect(screen.getByText("scouting.noScoutsHint")).toBeInTheDocument();
  });

  it("starts scouting and shows progress once sent", () => {
    const onScout = vi.fn();
    const { rerender } = render(
      <PlayerProfileScoutActionV2 availability={availability()} scoutStatus="idle" scoutError="boom" onScout={onScout} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "scouting.scoutBtn" }));
    expect(onScout).toHaveBeenCalled();
    expect(screen.getByText("boom")).toBeInTheDocument();
    rerender(<PlayerProfileScoutActionV2 availability={availability()} scoutStatus="sent" scoutError={null} onScout={onScout} />);
    expect(screen.getByText("scouting.scoutingInProgress")).toBeInTheDocument();
  });
});
