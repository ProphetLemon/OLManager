import type { GameStateData, NewsArticle } from "@/store/gameStore";
import { getTeamName } from "@/lib/common/helpers";

/** 1 hero + 12 grid cards (4x3). */
export const NEWS_PAGE_SIZE = 13;

export interface NewsTeamOption {
  id: string;
  name: string;
}

export interface NewsView {
  sorted: NewsArticle[];
  categories: string[];
  teamsInNews: NewsTeamOption[];
  filtered: NewsArticle[];
  totalPages: number;
  safePage: number;
  pageArticles: NewsArticle[];
}

export function buildNewsView(
  articles: NewsArticle[],
  teams: GameStateData["teams"],
  filters: { category: string | null; teamId: string | null; page: number },
): NewsView {
  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date));
  const categories = Array.from(new Set(sorted.map((n) => n.category)));
  const teamsInNews = Array.from(new Set(sorted.flatMap((n) => n.team_ids || [])))
    .map((id) => ({ id, name: getTeamName(teams, id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let filtered = sorted;
  if (filters.category) {
    filtered = filtered.filter((n) => n.category === filters.category);
  }
  if (filters.teamId) {
    const teamId = filters.teamId;
    filtered = filtered.filter((n) => (n.team_ids || []).includes(teamId));
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / NEWS_PAGE_SIZE));
  const safePage = Math.min(filters.page, totalPages - 1);
  const pageStart = safePage * NEWS_PAGE_SIZE;
  const pageArticles = filtered.slice(pageStart, pageStart + NEWS_PAGE_SIZE);

  return { sorted, categories, teamsInNews, filtered, totalPages, safePage, pageArticles };
}

export const NEWS_CATEGORY_STYLE: Record<string, { color: string; bg: string }> = {
  MatchReport: { color: "text-primary", bg: "bg-primary/10" },
  LeagueRoundup: { color: "text-primary/80", bg: "bg-primary/10" },
  StandingsUpdate: { color: "text-blue-500", bg: "bg-blue-500/10" },
  TransferRumour: { color: "text-purple-500", bg: "bg-purple-500/10" },
  InjuryNews: { color: "text-red-500", bg: "bg-red-500/10" },
  SeasonPreview: { color: "text-emerald-500", bg: "bg-emerald-500/10" },
  Editorial: { color: "text-muted-foreground", bg: "bg-muted" },
  ManagerialChange: { color: "text-orange-500", bg: "bg-orange-500/10" },
};

export function newsCategoryStyle(category: string): { color: string; bg: string } {
  return NEWS_CATEGORY_STYLE[category] ?? { color: "text-muted-foreground", bg: "bg-muted" };
}
