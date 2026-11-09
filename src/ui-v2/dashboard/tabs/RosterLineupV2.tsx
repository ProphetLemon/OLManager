import { useMemo } from "react";
import { useTranslation } from "react-i18next";


import type { ChampionMasteryEntryData, PlayerData } from "@/store/gameStore";
import { fallbackChampionForRole, resolvePlayerLolRole } from "@/lib/players/lolIdentity";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolveChampionSplash } from "@/lib/champions/championImages";
import { normalizeChampionKey } from "@/lib/champions/championIds";

import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";

type DraftRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";
const ROLE_ORDER: DraftRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

interface PlayerSeed {
  ign: string;
  role: string;
  champions: Array<Array<string | number>>;
}

const PLAYER_SEEDS: PlayerSeed[] = [];

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const TOP_CHAMPION_BY_IGN = new Map(
  PLAYER_SEEDS.map((player) => {
    const best = [...(player.champions ?? [])]
      .map((entry) => ({ name: String(entry[0] ?? ""), mastery: Number(entry[1] ?? 0) }))
      .filter((entry) => entry.name.length > 0)
      .sort((a, b) => b.mastery - a.mastery)[0];

    return [normalizeKey(player.ign), best?.name ?? ""] as const;
  }),
);

interface Props {
  roster: PlayerData[];
  championMasteries?: ChampionMasteryEntryData[];
  onNavigate?: (tab: string) => void;
  onSelectPlayer?: (id: string) => void;
}

export function RosterLineupV2({ roster, championMasteries = [], onNavigate, onSelectPlayer }: Props) {
  const { t } = useTranslation();

  const topMasteryByPlayer = useMemo(() => {
    const best = new Map<string, { championId: string; mastery: number }>();
    championMasteries.forEach((entry) => {
      const current = best.get(entry.player_id);
      const mastery = Number(entry.mastery ?? 0);
      if (!current || mastery > current.mastery) {
        best.set(entry.player_id, { championId: entry.champion_id, mastery });
      }
    });
    return new Map([...best.entries()].map(([id, v]) => [id, v.championId]));
  }, [championMasteries]);

  const lineup = useMemo(
    () =>
      ROLE_ORDER.map((role) => {
        const candidates = roster
          .filter((p) => resolvePlayerLolRole(p) === role)
          .sort((a, b) => calculateLolOvr(b) - calculateLolOvr(a));
        return { role, player: candidates[0] ?? null };
      }),
    [roster],
  );

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          Plantilla
        </CardTitle>
        <button
          type="button"
          onClick={() => onNavigate?.("Squad")}
          className="font-heading text-xs font-bold uppercase tracking-wider text-club-text hover:underline"
        >
          5 titular
        </button>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="grid h-full gap-2 lg:grid-cols-5">
          {lineup.map(({ role, player }) => {
            const photo = player
              ? resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url)
              : null;
            const ovr = player ? calculateLolOvr(player) : null;
            const condition = player?.condition ?? null;
            const morale = player?.morale ?? null;
            const topChampion = player
              ? topMasteryByPlayer.get(player.id) ??
                TOP_CHAMPION_BY_IGN.get(normalizeKey(player.match_name)) ??
                fallbackChampionForRole(player.id, role) ??
                ""
              : "";
            const splash = topChampion
              ? resolveChampionSplash(normalizeChampionKey(topChampion))
              : null;

            return (
              <div
                key={role}
                onClick={() => player && onSelectPlayer?.(player.id)}
                className={cn(
                  "relative overflow-hidden rounded-lg border border-border bg-card",
                  player && "cursor-pointer transition-colors hover:border-primary/50",
                )}
              >
                {splash && (
                  <>
                    <div
                      className="absolute inset-0 bg-cover bg-center opacity-40"
                      style={{ backgroundImage: `url(${splash})` }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-black/85" />
                  </>
                )}

                <div className="relative z-10 p-3">
                  <p className="font-heading text-2xs font-bold uppercase tracking-widest text-white/70">
                    {t(`tactics.lol.roles.${role}`, { defaultValue: role })}
                  </p>

                  <div className="mt-2 flex items-center gap-2">
                    {photo ? (
                      <img
                        src={photo}
                        alt={player?.match_name ?? role}
                        className="size-9 shrink-0 rounded-full border border-white/20 object-cover"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="size-9 shrink-0 rounded-full border border-white/10 bg-muted" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-heading text-sm font-bold text-white">
                        {player?.match_name ?? "—"}
                      </p>
                      <p className="text-caption text-white/70 tabular-nums">
                        OVR {ovr ?? "—"}
                      </p>
                      {topChampion && (
                        <p className="truncate text-caption text-club-text">{topChampion}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-1">
                    <StatBox label={t("common.condition")} value={condition} accent="emerald" />
                    <StatBox label={t("common.morale")} value={morale} accent="amber" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null;
  accent: "emerald" | "amber";
}) {
  const colorMap = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
  };
  return (
    <div className="rounded-md bg-black/40 px-2 py-1 text-center">
      <div className="text-2xs uppercase tracking-wider text-white/60">{label}</div>
      <div className={cn("font-heading text-sm font-bold tabular-nums", colorMap[accent])}>
        {value !== null ? `${value}%` : "—"}
      </div>
    </div>
  );
}


