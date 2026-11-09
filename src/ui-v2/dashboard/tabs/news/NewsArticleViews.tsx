import {
  ArrowLeft,
  BarChart3,
  Clock,
  FileText,
  Newspaper,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GameStateData, NewsArticle } from "@/store/gameStore";
import { formatMatchDate, getTeamName } from "@/lib/common/helpers";
import { newsCategoryStyle } from "@/lib/news/helpers";
import { Badge } from "@/ui-v2/components/ui/badge";
import { Button } from "@/ui-v2/components/ui/button";
import { Card, CardContent } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";

const CAT_ICONS: Record<string, typeof FileText> = {
  MatchReport: Newspaper,
  LeagueRoundup: Trophy,
  StandingsUpdate: BarChart3,
  TransferRumour: TrendingUp,
};

type Teams = GameStateData["teams"];

function CategoryBadge({ category }: { category: string }) {
  const { t } = useTranslation();
  const style = newsCategoryStyle(category);
  const Icon = CAT_ICONS[category] ?? FileText;
  return (
    <Badge
      variant="ghost"
      className={cn(
        "h-auto gap-1.5 px-2.5 py-1 font-heading text-2xs font-bold uppercase tracking-widest",
        style.color,
        style.bg,
      )}
    >
      <Icon />
      {t(`news.categories.${category}`)}
    </Badge>
  );
}

function ArticleDate({ date }: { date: string }) {
  const { i18n } = useTranslation();
  return (
    <span className="flex items-center gap-1 text-2xs text-muted-foreground">
      <Clock className="size-3" />
      {formatMatchDate(date, i18n.language)}
    </span>
  );
}

function ScoreLine({
  article,
  teams,
  size,
}: {
  article: NewsArticle;
  teams: Teams;
  size: "sm" | "md" | "lg";
}) {
  const score = article.match_score;
  if (!score) return null;
  return (
    <div
      className={cn(
        "flex items-center rounded-lg bg-muted/50",
        size === "lg" ? "justify-center gap-4 p-4" : size === "md" ? "gap-3 p-3" : "gap-2",
      )}
    >
      <span className="font-heading text-sm font-bold">{getTeamName(teams, score.home_team_id)}</span>
      <span className="rounded-lg bg-primary/10 px-3 py-1 font-heading text-lg font-bold tabular-nums text-primary">
        {score.home_goals} – {score.away_goals}
      </span>
      <span className="font-heading text-sm font-bold">{getTeamName(teams, score.away_team_id)}</span>
    </div>
  );
}

function TeamChips({
  article,
  teams,
  limit,
  onSelectTeam,
}: {
  article: NewsArticle;
  teams: Teams;
  limit?: number;
  onSelectTeam?: (id: string) => void;
}) {
  if (!onSelectTeam || article.team_ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {article.team_ids.slice(0, limit).map((tid) => (
        <button
          key={tid}
          type="button"
          onClick={() => onSelectTeam(tid)}
          className="rounded-md bg-primary/5 px-2 py-0.5 font-heading text-2xs font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/10"
        >
          {getTeamName(teams, tid)}
        </button>
      ))}
    </div>
  );
}

export function HeroArticle({
  article,
  teams,
  onSelect,
  onSelectTeam,
}: {
  article: NewsArticle;
  teams: Teams;
  onSelect: () => void;
  onSelectTeam?: (id: string) => void;
}) {
  return (
    <Card className="group gap-0 py-0 transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-3 p-6">
        <button type="button" onClick={onSelect} className="flex flex-col gap-3 text-left">
          <span className="flex items-center gap-2">
            <CategoryBadge category={article.category} />
            <ArticleDate date={article.date} />
          </span>
          <h2 className="font-heading text-xl font-bold uppercase leading-tight transition-colors group-hover:text-primary">
            {article.headline}
          </h2>
          <ScoreLine article={article} teams={teams} size="md" />
          <span className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{article.body}</span>
        </button>
        <div className="flex items-center justify-between border-t pt-3">
          <p className="font-heading text-2xs uppercase tracking-widest text-muted-foreground">— {article.source}</p>
          <TeamChips article={article} teams={teams} limit={3} onSelectTeam={onSelectTeam} />
        </div>
      </CardContent>
    </Card>
  );
}

export function ArticleCard({
  article,
  teams,
  onSelect,
}: {
  article: NewsArticle;
  teams: Teams;
  onSelect: () => void;
}) {
  return (
    <Card className="group gap-0 py-0 transition-shadow hover:shadow-md">
      <button type="button" onClick={onSelect} className="flex h-full flex-col gap-2 p-4 text-left">
        <CategoryBadge category={article.category} />
        <h3 className="font-heading text-sm font-bold uppercase leading-snug transition-colors group-hover:text-primary">
          {article.headline}
        </h3>
        <ScoreLine article={article} teams={teams} size="sm" />
        <span className="line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">{article.body}</span>
        <span className="mt-1 flex items-center justify-between border-t pt-2">
          <span className="font-heading text-2xs uppercase tracking-widest text-muted-foreground">
            {article.source}
          </span>
          <ArticleDate date={article.date} />
        </span>
      </button>
    </Card>
  );
}

export function ArticleDetail({
  article,
  teams,
  onBack,
  onSelectTeam,
}: {
  article: NewsArticle;
  teams: Teams;
  onBack: () => void;
  onSelectTeam?: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="self-start font-heading uppercase tracking-wider"
      >
        <ArrowLeft />
        {t("news.backToNews")}
      </Button>
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 md:p-6">
          <div className="flex items-center gap-3">
            <CategoryBadge category={article.category} />
            <ArticleDate date={article.date} />
          </div>
          <h1 className="font-heading text-2xl font-bold uppercase leading-tight">{article.headline}</h1>
          <ScoreLine article={article} teams={teams} size="lg" />
          <div className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">{article.body}</div>
          <div className="flex items-center justify-between border-t pt-4">
            <p className="font-heading text-2xs uppercase tracking-widest text-muted-foreground">
              — {article.source}
            </p>
            <TeamChips article={article} teams={teams} onSelectTeam={onSelectTeam} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
