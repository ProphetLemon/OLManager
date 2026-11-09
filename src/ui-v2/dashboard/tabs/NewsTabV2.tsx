import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, Newspaper } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GameStateData } from "@/store/gameStore";
import { resolveNewsArticle } from "@/lib/i18n/backendI18n";
import { buildNewsView } from "@/lib/news/helpers";
import { Button } from "@/ui-v2/components/ui/button";
import { cn } from "@/ui-v2/lib/utils";
import { ArticleCard, ArticleDetail, HeroArticle } from "./news/NewsArticleViews";

interface NewsTabV2Props {
  gameState: GameStateData;
  onSelectTeam?: (id: string) => void;
}

const PILL =
  "rounded-full px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider transition-colors";

export function NewsTabV2({ gameState, onSelectTeam }: NewsTabV2Props) {
  const { t } = useTranslation();
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const articles = useMemo(() => (gameState.news || []).map(resolveNewsArticle), [gameState.news]);
  const view = buildNewsView(articles, gameState.teams, {
    category: filterCategory,
    teamId: filterTeamId,
    page,
  });
  const { sorted, categories, teamsInNews, filtered, totalPages, safePage, pageArticles } = view;
  const selectedArticle = selectedId
    ? (filtered.find((a) => a.id === selectedId) ?? sorted.find((a) => a.id === selectedId))
    : null;

  const shell = "news-v2 flex h-full flex-col overflow-y-auto p-6 scrollbar-v2";

  if (sorted.length === 0) {
    return (
      <div className={shell}>
        <div className="py-16 text-center">
          <Newspaper className="mx-auto mb-3 size-12 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("news.noNews")}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t("news.newsWillAppear")}</p>
        </div>
      </div>
    );
  }

  if (selectedArticle) {
    return (
      <div className={shell}>
        <ArticleDetail
          article={selectedArticle}
          teams={gameState.teams}
          onBack={() => setSelectedId(null)}
          onSelectTeam={onSelectTeam}
        />
      </div>
    );
  }

  const selectCategory = (cat: string | null) => {
    setFilterCategory(cat);
    setPage(0);
  };

  return (
    <div className={shell}>
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => selectCategory(null)}
            className={cn(PILL, !filterCategory ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}
          >
            {t("common.all")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => selectCategory(filterCategory === cat ? null : cat)}
              className={cn(PILL, filterCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}
            >
              {t(`news.categories.${cat}`)}
            </button>
          ))}

          {teamsInNews.length > 1 && (
            <div className="ml-auto flex items-center gap-2">
              <Filter className="size-3.5 text-muted-foreground" />
              <select
                value={filterTeamId || ""}
                aria-label={t("news.allTeams")}
                onChange={(e) => {
                  setFilterTeamId(e.target.value || null);
                  setPage(0);
                }}
                className="h-8 min-w-40 rounded-lg border border-input bg-transparent px-2 font-heading text-xs font-bold uppercase tracking-wider outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">{t("news.allTeams")}</option>
                {teamsInNews.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!teamsInNews.length && (
            <span className="ml-auto text-xs text-muted-foreground">
              {t("news.nArticles", { count: filtered.length })}
            </span>
          )}
        </div>

        {pageArticles.length > 0 && (
          <HeroArticle
            article={pageArticles[0]}
            teams={gameState.teams}
            onSelect={() => setSelectedId(pageArticles[0].id)}
            onSelectTeam={onSelectTeam}
          />
        )}

        {pageArticles.length > 1 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pageArticles.slice(1).map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                teams={gameState.teams}
                onSelect={() => setSelectedId(article.id)}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={t("common.previousPage")}
              disabled={safePage === 0}
              onClick={() => setPage(Math.max(0, safePage - 1))}
            >
              <ChevronLeft />
            </Button>
            <span className="font-heading text-xs font-bold uppercase tracking-wider tabular-nums text-muted-foreground">
              {safePage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("common.nextPage")}
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
