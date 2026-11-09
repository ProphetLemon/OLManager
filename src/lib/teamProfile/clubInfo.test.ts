import { describe, expect, it } from "vitest";

import type { TeamData } from "@/store/gameStore";
import {
  defaultTeamLogoSrc,
  formatLeaguePosition,
  formatWinRate,
  resolveErlLeagueName,
} from "@/lib/teamProfile/clubInfo";
import { resolveTeamProfileLogo } from "@/lib/teamProfile/logo";

const academy = (erl: string | undefined, extra: Record<string, unknown> = {}) =>
  ({
    id: "academy-x",
    name: "Nowhere Academy",
    team_kind: "Academy",
    academy: { erl_assignment: erl ? { erl_league_id: erl } : undefined, ...extra },
  }) as unknown as TeamData;

describe("teamProfile club info helpers", () => {
  it("maps ERL ids to display names for academy teams only", () => {
    expect(resolveErlLeagueName(academy("liga-espanola"))).toBe("LES");
    expect(resolveErlLeagueName(academy("LFL"))).toBe("LFL");
    expect(resolveErlLeagueName(academy("prime-league"))).toBe("Prime League");
    expect(resolveErlLeagueName(academy("unknown-league"))).toBeNull();
    expect(resolveErlLeagueName(academy(undefined))).toBeNull();
    expect(
      resolveErlLeagueName({ ...academy("lfl"), team_kind: "Main" } as unknown as TeamData),
    ).toBeNull();
  });

  it("formats win rate over decided games", () => {
    expect(formatWinRate(3, 1)).toBe("75%");
    expect(formatWinRate(0, 0)).toBe("0%");
  });

  it("formats the league position with a dash fallback", () => {
    expect(formatLeaguePosition({ leaguePos: 3 })).toBe("#3");
    expect(formatLeaguePosition({ leaguePos: 0 })).toBe("—");
  });

  it("resolves logos in priority order", () => {
    expect(defaultTeamLogoSrc("lec-g2")).toBe("/teams-icons/g2.webp");
    expect(
      resolveTeamProfileLogo({ id: "t", name: "T", logo_url: "/teams-icons/t.webp" } as TeamData),
    ).toBe("/teams-icons/t.webp");
    expect(
      resolveTeamProfileLogo(academy("lfl", { branding: { current_logo_url: "https://x/y.png" } })),
    ).toBe("https://x/y.png");
    expect(resolveTeamProfileLogo(academy("lfl"))).toBe("/teams-icons/nowhereacademy.webp");
  });
});
