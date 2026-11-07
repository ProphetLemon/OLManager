import { Crown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader } from "@/ui-v2/_legacy/components/ui";
import { resolveChampionTile } from "@/lib/champions/championImages";

interface ChampionMasteryItem {
  championId: string;
  championName: string;
  mastery: number;
  rank: "insignia" | 1 | 2 | 3;
  wr: number;
  games: number;
}

interface PlayerProfileChampionsCardProps {
  champions: ChampionMasteryItem[];
  onViewChampion?: (championKey: string) => void;
}

export default function PlayerProfileChampionsCard({ champions, onViewChampion }: PlayerProfileChampionsCardProps) {
  const { t } = useTranslation();

  const handleChampionClick = (championId: string) => {
    onViewChampion?.(championId);
  };

  return (
    <Card className="lg:col-span-2 min-h-[304px]">
      <CardHeader>{t("playerProfile.championPoolTitle")}</CardHeader>
      <CardBody className="py-4 px-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
          {champions.map((item) => (
            <button
              type="button"
              key={`${item.rank}-${item.championId}`}
              onClick={() => handleChampionClick(item.championId)}
              className="relative rounded-xl overflow-hidden border border-border min-h-[192px] bg-card text-left cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(251,191,36,0.2)] hover:border-yellow-400"
            >
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${resolveChampionTile(item.championId) ?? ""})` }}
              />
              <div className="absolute inset-0 bg-linear-to-b from-black/45 via-black/45 to-black/75" />

              <div className="relative z-10 p-2.5 h-full flex flex-col">
                <div className="flex items-start justify-between">
                  {item.rank === "insignia" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-heading font-bold uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-300/35">
                      <Crown className="w-3 h-3" /> {t("playerProfile.championInsignia")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-heading font-bold uppercase tracking-wide bg-white/20 text-white border border-white/35">
                      #{item.rank}
                    </span>
                  )}

                  {item.games > 0 && (
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={`text-lg font-heading font-black ${item.wr >= 55 ? "text-emerald-300" : item.wr >= 48 ? "text-amber-300" : "text-rose-300"}`}>
                      {item.wr.toFixed(1)}% {t("playerProfile.championWinRateShort")}
                    </span>
                    <div className="w-14 h-1 rounded-full bg-white/15 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${item.wr >= 55 ? "bg-emerald-400" : item.wr >= 48 ? "bg-amber-400" : "bg-rose-400"}`}
                        style={{ width: `${Math.min(100, item.wr)}%` }}
                      />
                    </div>
                  </div>
                  )}
                </div>

                <div className="mt-auto">
                  <p className="text-2xl font-heading font-black text-white leading-none truncate">{item.championName}</p>
                  <div className="mt-1 flex items-center justify-between text-white/90">
                    <p className="text-xs">{t("playerProfile.championMasteryLabel", { value: item.mastery })}</p>
                    {item.games > 0 && (
                      <p className="text-2xl font-heading font-black leading-none">
                        {item.games} <span className="text-lg">{t("playerProfile.championGames")}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}



