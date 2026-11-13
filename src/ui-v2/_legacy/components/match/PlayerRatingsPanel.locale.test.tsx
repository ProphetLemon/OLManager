import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let language = "es";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language } }),
}));

import { PlayerRatingsPanel } from "./PostMatchHelpers";
import type { MatchSnapshot } from "./types";

const player = (id: string, name: string) => ({ id, name, position: "Midfielder" });
const snapshot = {
  home_team: { id: "h", name: "Alpha", players: [player("p1", "Ana"), player("p2", "Bea")] },
  away_team: { id: "a", name: "Beta", players: [] },
  events: [
    { minute: 10, event_type: "Goal", side: "Home", player_id: "p1", secondary_player_id: null },
  ],
} as unknown as MatchSnapshot;

afterEach(() => {
  language = "es";
});

describe("PlayerRatingsPanel decimal mark", () => {
  it.each([
    ["es", ","],
    ["en", "."],
  ])("writes every rating, the man of the match included, with the %s mark", (lang, mark) => {
    language = lang;
    const { container } = render(<PlayerRatingsPanel snapshot={snapshot} side="Home" teamColor="#fff" userSide="Home" />);
    const ratings = [...container.querySelectorAll("span")]
      .map((span) => span.textContent ?? "")
      .filter((text) => /^\d+[.,]\d$/.test(text));
    expect(ratings.length).toBeGreaterThanOrEqual(3);
    for (const rating of ratings) expect(rating).toContain(mark);
  });
});
