import { useMemo } from "react";
import { Swords, Skull, Handshake, Star, Pickaxe, TrendingUp, Eye, Crosshair } from "lucide-react";
import type { PlayerSeasonStats } from "@/store/gameStore";
import type { SeasonTotals } from "@/lib/playerProfile/seasonTotals";
import { cn } from "@/ui-v2/lib/utils";
import { PlayerProfileSectionV2 } from "./PlayerProfileSectionV2";

interface Props {
  stats: PlayerSeasonStats;
  /** Wins, losses, deaths, CS and vision of the running season, summed from the match records. */
  totals?: SeasonTotals | null;
  t: (key: string, options?: Record<string, string>) => string;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export default function PlayerProfileStatsCardV2({ stats, totals, t }: Props) {
  // The backend records `appearances`, `kills` and `assists` per season; the other numbers
  // (wins, losses, deaths, CS, vision) are only kept per match, so they come from `totals`
  // (summed from the match records) and are left out when neither source has them instead of
  // showing a zero that looks like data.
  const games = num(stats.games_played) ?? num(stats.appearances) ?? 0;
  const wins = num(stats.wins) ?? totals?.wins ?? null;
  const losses = num(stats.losses) ?? totals?.losses ?? null;
  const kills = num(stats.kills);
  const assists = num(stats.assists);
  const deaths = num(stats.deaths) ?? totals?.deaths ?? null;
  const cs = num(stats.cs) ?? totals?.cs ?? null;
  const vision = num(stats.vision_score) ?? totals?.vision ?? null;
  const kda = useMemo(() => {
    if (games === 0 || kills === null || assists === null || deaths === null) return null;
    return ((kills + assists) / (deaths || 1)).toFixed(1);
  }, [games, kills, assists, deaths]);

  const items = [
    { icon: Swords, label: t("common.games"), value: String(games) },
    wins !== null && { icon: TrendingUp, label: t("common.wins"), value: String(wins), color: "text-positive" },
    losses !== null && { icon: Crosshair, label: t("common.losses"), value: String(losses), color: "text-negative" },
    kda !== null && { icon: Star, label: "KDA", value: kda },
    cs !== null && { icon: Pickaxe, label: "CS", value: String(cs) },
    vision !== null && { icon: Eye, label: t("common.vision"), value: String(vision) },
    kills !== null && { icon: Skull, label: t("common.kills"), value: String(kills) },
    assists !== null && { icon: Handshake, label: t("common.assists"), value: String(assists) },
  ].filter((item): item is { icon: typeof Swords; label: string; value: string; color?: string } => item !== false);

  return (
    <PlayerProfileSectionV2
      title={t("playerProfile.seasonStats", { defaultValue: "Estadísticas de temporada" })}
    >
      {games === 0 ? (
        <p className="text-sm italic text-muted-foreground/70">
          {t("playerProfile.noStats", { defaultValue: "Sin partidos jugados esta temporada." })}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {items.map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
              <Icon className="size-5 shrink-0 text-muted-foreground/70" />
              <div className="min-w-0">
                <p className="font-heading text-caption font-bold uppercase tracking-wider text-muted-foreground">
                  {label}
                </p>
                <p className={cn("font-heading text-lg font-bold tabular-nums", color ?? "text-foreground")}>
                  {value}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </PlayerProfileSectionV2>
  );
}
