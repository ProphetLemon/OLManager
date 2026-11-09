import { Crown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveChampionTile } from "@/lib/champions/championImages";
import type { TopChampionMastery } from "@/lib/playerProfile/champions";
import { cn } from "@/ui-v2/lib/utils";
import { PlayerProfileSectionV2 } from "./PlayerProfileSectionV2";

interface PlayerProfileChampionsCardV2Props {
  champions: TopChampionMastery[];
  onViewChampion?: (championKey: string) => void;
}

function winRateTone(wr: number): { text: string; bar: string } {
  if (wr >= 55) return { text: "text-positive", bar: "bg-positive" };
  if (wr >= 48) return { text: "text-warning", bar: "bg-warning" };
  return { text: "text-negative", bar: "bg-negative" };
}

export default function PlayerProfileChampionsCardV2({
  champions,
  onViewChampion,
}: PlayerProfileChampionsCardV2Props) {
  const { t } = useTranslation();

  return (
    <PlayerProfileSectionV2 title={t("playerProfile.championPoolTitle")} className="min-h-[304px]">
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {champions.map((item) => {
          const tone = winRateTone(item.wr);
          return (
            <button
              type="button"
              key={`${item.rank}-${item.championId}`}
              onClick={() => onViewChampion?.(item.championId)}
              className="relative min-h-[192px] cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${resolveChampionTile(item.championId) ?? ""})` }}
              />
              <div className="absolute inset-0 bg-linear-to-b from-black/45 via-black/45 to-black/75" />

              <div className="relative z-10 flex h-full flex-col p-2.5">
                <div className="flex items-start justify-between">
                  {item.rank === "insignia" ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/35 bg-amber-500/20 px-2 py-0.5 font-heading text-2xs font-bold uppercase tracking-wide text-amber-300">
                      <Crown className="size-3" /> {t("playerProfile.championInsignia")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md border border-white/35 bg-white/20 px-2 py-0.5 font-heading text-2xs font-bold uppercase tracking-wide text-white">
                      #{item.rank}
                    </span>
                  )}

                  {item.games > 0 ? (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={cn("font-heading text-lg font-black tabular-nums", tone.text)}>
                        {item.wr.toFixed(1)}% {t("playerProfile.championWinRateShort")}
                      </span>
                      <div className="h-1 w-14 overflow-hidden rounded-full bg-white/15">
                        <div
                          className={cn("h-full rounded-full", tone.bar)}
                          style={{ width: `${Math.min(100, item.wr)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-auto">
                  <p className="truncate font-heading text-2xl font-black uppercase leading-none text-white">
                    {item.championName}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-white/90">
                    <p className="text-xs tabular-nums">
                      {t("playerProfile.championMasteryLabel", { value: item.mastery })}
                    </p>
                    {item.games > 0 ? (
                      <p className="font-heading text-2xl font-black leading-none tabular-nums">
                        {item.games} <span className="text-lg">{t("playerProfile.championGames")}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </PlayerProfileSectionV2>
  );
}
