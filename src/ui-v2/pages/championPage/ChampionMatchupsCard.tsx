import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingDown, TrendingUp } from "lucide-react";
import { getChampionMatchups, type ChampionMatchup } from "@/lib/champions/championMatchups";
import { resolveChampionTile } from "@/lib/champions/championImages";
import { championDisplayName } from "@/lib/champions/championNames";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";

interface Props {
  championKey: string;
}

/** Strong and weak matchups of a champion from the bundled counter dataset. */
export default function ChampionMatchupsCard({ championKey }: Props) {
  const { t } = useTranslation();
  const { strongAgainst, weakAgainst } = useMemo(() => getChampionMatchups(championKey), [championKey]);
  const empty = strongAgainst.length === 0 && weakAgainst.length === 0;

  return (
    <Card data-testid="champion-matchups-card">
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-xs uppercase tracking-widest text-muted-foreground">
          {t("championPage.counterTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-sm text-muted-foreground">{t("championPage.counterEmpty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <MatchupList title={t("championPage.counterStrong")} items={strongAgainst} tone="strong" />
            <MatchupList title={t("championPage.counterWeak")} items={weakAgainst} tone="weak" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MatchupList({ title, items, tone }: { title: string; items: ChampionMatchup[]; tone: "strong" | "weak" }) {
  const { t } = useTranslation();
  const Icon = tone === "strong" ? TrendingUp : TrendingDown;
  return (
    <section aria-label={title}>
      <h3
        className={cn(
          "mb-2 flex items-center gap-2 font-heading text-xs uppercase tracking-widest",
          tone === "strong" ? "text-positive" : "text-negative",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("championPage.noData")}</p>
      ) : (
        <ul className="divide-y divide-border/30">
          {items.map((item) => {
            const name = championDisplayName(item.championId);
            const tile = resolveChampionTile(item.championId);
            return (
              <li key={item.championId} className="flex items-center gap-3 py-2">
                {tile && <img src={tile} alt="" className="size-8 shrink-0 rounded object-cover" />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</span>
                <span
                  className="font-heading text-sm font-bold tabular-nums text-foreground"
                  aria-label={t("championPage.counterStrength", { value: item.value })}
                >
                  {item.value}/5
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
