import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PreMatchLineup, {
  condColor,
  getPlayerLolRole,
  getPositionOvr,
  statColor,
} from "@/ui-v2/_legacy/components/match/PreMatchLineup";
import type { EnginePlayerData, EngineTeamData } from "@/ui-v2/_legacy/components/match/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, arg?: unknown) => {
      if (
        typeof arg === "object" &&
        arg !== null &&
        "count" in arg &&
        typeof (arg as Record<string, unknown>).count !== "undefined"
      ) {
        return `${key}:${String((arg as Record<string, unknown>).count)}`;
      }
      return key;
    },
  }),
}));

const makePlayer = (overrides: Partial<EnginePlayerData> = {}): EnginePlayerData => ({
  id: "p1",
  name: "Test",
  role: "Midfielder",
  condition: 100,
  fitness: 75,
  mechanics: 70,
  laning: 70,
  teamfighting: 70,
  macro_play: 70,
  consistency: 70,
  shotcalling: 50,
  champion_pool: 70,
  discipline: 70,
  mental_resilience: 70,
  traits: [],
  ...overrides,
});

const makeTeam = (overrides: Partial<EngineTeamData> = {}): EngineTeamData => ({
  id: "team1",
  name: "Test FC",
  draft_strategy: "Balanced",
  players: [
    makePlayer({ id: "top", name: "Top One", role: "Top" }),
    makePlayer({ id: "jg", name: "Jg One", role: "Jungle" }),
    makePlayer({ id: "mid", name: "Mid One", role: "Mid" }),
    makePlayer({ id: "adc", name: "Adc One", role: "Adc" }),
    makePlayer({ id: "sup", name: "Sup One", role: "Support" }),
  ],
  ...overrides,
});

describe("PreMatchLineup helpers", () => {
  it("maps engine roles into LoL roles", () => {
    expect(getPlayerLolRole(makePlayer({ role: "Top" }))).toBe("TOP");
    expect(getPlayerLolRole(makePlayer({ role: "Jungle" }))).toBe("JUNGLE");
    expect(getPlayerLolRole(makePlayer({ role: "Mid" }))).toBe("MID");
    expect(getPlayerLolRole(makePlayer({ role: "Adc" }))).toBe("ADC");
    expect(getPlayerLolRole(makePlayer({ role: "Support" }))).toBe("SUPPORT");
  });

  it("computes LoL OVR from visible 9 stats", () => {
    const player = makePlayer({
      mechanics: 80,
      laning: 70,
      teamfighting: 75,
      macro_play: 65,
      consistency: 60,
      shotcalling: 70,
      champion_pool: 68,
      discipline: 72,
      mental_resilience: 74,
    });
    expect(getPositionOvr(player)).toBe(Math.round((80 + 70 + 75 + 65 + 60 + 70 + 68 + 72 + 74) / 9));
  });

  it("keeps condition/stat color helpers", () => {
    expect(condColor(90)).toBe("text-club-text");
    expect(condColor(60)).toBe("text-amber-400");
    expect(condColor(20)).toBe("text-red-400");
    expect(statColor(80)).toBe("text-club-text font-bold");
    expect(statColor(65)).toBe("text-foreground");
    expect(statColor(40)).toBe("text-muted-foreground");
  });
});

describe("PreMatchLineup component", () => {
  const homeTeam = makeTeam();
  const awayTeam = makeTeam({ id: "away", name: "Rival United" });
  const defaultProps = {
    homeTeam,
    homeBench: [makePlayer({ id: "b1", name: "Bench One", role: "Top", condition: 90 })],
    awayTeam,
    awayBench: [makePlayer({ id: "ab1", name: "Away Bench", role: "Mid", condition: 85 })],
    homeTeamColor: "#ff0000",
    awayTeamColor: "#0000ff",
    userSide: "Home" as const,
    selectedStarterId: null as string | null,
    isAutoSelecting: false,
    onSelectStarter: vi.fn(),
    onSwap: vi.fn(),
    onAutoSelect: vi.fn(),
  };

  it("renders both teams' 5 LoL starters and bench", () => {
    render(<PreMatchLineup {...defaultProps} />);
    // Home team players
    expect(screen.getAllByText("Top One").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jg One").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mid One").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Adc One").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sup One").length).toBeGreaterThan(0);
    // Home bench
    expect(screen.getByText("Bench One")).toBeInTheDocument();
    // Away bench
    expect(screen.getByText("Away Bench")).toBeInTheDocument();
  });

  it("renders explicit profile images from match player snapshots", () => {
    render(
      <PreMatchLineup
        {...defaultProps}
        homeTeam={makeTeam({
          players: [
            makePlayer({
              id: "custom-top",
              name: "Custom Top",
              role: "Top",
              profile_image_url: "/images/players/custom-top.webp",
            }),
          ],
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Custom Top" })).toHaveAttribute(
      "src",
      "/images/players/custom-top.webp",
    );
  });

  it("calls callbacks for auto-select, starter select and swap on user side", () => {
    const onAutoSelect = vi.fn();
    const onSelectStarter = vi.fn();
    const onSwap = vi.fn();
    render(
      <PreMatchLineup
        {...defaultProps}
        selectedStarterId="mid"
        onAutoSelect={onAutoSelect}
        onSelectStarter={onSelectStarter}
        onSwap={onSwap}
      />,
    );

    fireEvent.click(screen.getByText("match.autoSelect5"));
    fireEvent.click(screen.getAllByText("Top One")[0]);
    fireEvent.click(screen.getByText("Bench One"));

    expect(onAutoSelect).toHaveBeenCalledOnce();
    expect(onSelectStarter).toHaveBeenCalledWith("top");
    expect(onSwap).toHaveBeenCalledWith("b1");
  });
});
