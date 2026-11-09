import { describe, expect, it } from "vitest";

import type { NewsArticle, TeamData } from "@/store/gameStore";
import { buildNewsView, newsCategoryStyle, NEWS_PAGE_SIZE } from "./helpers";

const teams = [
  { id: "t1", name: "Zeta" },
  { id: "t2", name: "Alpha" },
] as TeamData[];

function article(id: string, date: string, over: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id, headline: id, body: "", source: "s", date, category: "MatchReport",
    team_ids: [], player_ids: [], match_score: null, read: false, ...over,
  };
}

describe("buildNewsView", () => {
  it("sorts newest first and lists categories and teams alphabetically", () => {
    const view = buildNewsView(
      [
        article("a", "2026-01-01", { team_ids: ["t1"] }),
        article("b", "2026-02-01", { category: "Editorial", team_ids: ["t2"] }),
      ],
      teams,
      { category: null, teamId: null, page: 0 },
    );
    expect(view.sorted.map((n) => n.id)).toEqual(["b", "a"]);
    expect(view.categories).toEqual(["Editorial", "MatchReport"]);
    expect(view.teamsInNews.map((t) => t.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("filters by category and team", () => {
    const items = [
      article("a", "2026-01-01", { team_ids: ["t1"] }),
      article("b", "2026-02-01", { category: "Editorial", team_ids: ["t1", "t2"] }),
    ];
    expect(buildNewsView(items, teams, { category: "Editorial", teamId: null, page: 0 }).filtered).toHaveLength(1);
    expect(buildNewsView(items, teams, { category: null, teamId: "t2", page: 0 }).filtered.map((n) => n.id)).toEqual(["b"]);
  });

  it("paginates and clamps the page", () => {
    const items = Array.from({ length: NEWS_PAGE_SIZE + 2 }, (_, i) =>
      article(`n${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`),
    );
    const view = buildNewsView(items, teams, { category: null, teamId: null, page: 9 });
    expect(view.totalPages).toBe(2);
    expect(view.safePage).toBe(1);
    expect(view.pageArticles).toHaveLength(2);
  });
});

describe("newsCategoryStyle", () => {
  it("falls back for unknown categories", () => {
    expect(newsCategoryStyle("Nope").bg).toBe("bg-muted");
  });
});
