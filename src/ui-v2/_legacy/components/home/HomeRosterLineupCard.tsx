import { useMemo } from "react";
import { useTranslation } from "react-i18next";


import type { ChampionMasteryEntryData, PlayerData } from "@/store/gameStore";
import { Card, CardBody, CardHeader } from "@/ui-v2/_legacy/components/ui";
import { fallbackChampionForRole, resolvePlayerLolRole } from "@/lib/players/lolIdentity";

import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { normalizeChampionKey } from "@/lib/champions/championIds";
import { resolveChampionSplash } from "@/lib/champions/championImages";

type DraftRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

const ROLE_ORDER: DraftRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

interface HomeRosterLineupCardProps {
  roster: PlayerData[];
  championMasteries?: ChampionMasteryEntryData[];
  onNavigate?: (tab: string) => void;
}

interface PlayerSeed {
  ign: string;
  role: string;
  champions: Array<Array<string | number>>;
}

const PLAYER_SEEDS: PlayerSeed[] = [];

const TOP_CHAMPION_BY_IGN = new Map(
  PLAYER_SEEDS.map((player) => {
    const best = [...(player.champions ?? [])]
      .map((entry) => ({ name: String(entry[0] ?? ""), mastery: Number(entry[1] ?? 0) }))
      .filter((entry) => entry.name.length > 0)
      .sort((a, b) => b.mastery - a.mastery)[0];

    return [normalizeKey(player.ign), best?.name ?? ""] as const;
  }),
);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function HomeRosterLineupCard({
  roster,
  championMasteries = [],
  onNavigate,
}: HomeRosterLineupCardProps) {
  const { t } = useTranslation();

  const topMasteryChampionByPlayerId = useMemo(() => {
    const bestByPlayer = new Map<string, { championId: string; mastery: number }>();
    championMasteries.forEach((entry) => {
      const current = bestByPlayer.get(entry.player_id);
      const mastery = Number(entry.mastery ?? 0);
      if (!current || mastery > current.mastery) {
        bestByPlayer.set(entry.player_id, { championId: entry.champion_id, mastery });
      }
    });
    return new Map(
      [...bestByPlayer.entries()].map(([playerId, value]) => [playerId, value.championId]),
    );
  }, [championMasteries]);

  const lineup = useMemo(
    () =>
      ROLE_ORDER.map((role) => {
        const candidates = roster
          .filter(
            (player) => resolvePlayerLolRole(player) === role,
          )
          .sort(
            (a, b) =>
              calculateLolOvr(b) -
              calculateLolOvr(a),
          );

        return {
          role,
          player: candidates[0] ?? null,
        };
      }),
    [roster],
  );

  return (
    <Card>
      <CardHeader
        action={
          <button
            onClick={() => onNavigate?.("Squad")}
            className="text-primary-500 dark:text-primary-400 text-xs font-heading font-bold uppercase tracking-wider hover:text-primary-600 dark:hover:text-primary-300 transition-colors"
          >
            {t("home.fullRoster")}
          </button>
        }
      >
        {t("home.roster")}
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {lineup.map(({ role, player }, index) => {
            const photo = player ? resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url) : null;
            const ovr = player ? calculateLolOvr(player) : null;
            const condition = player?.condition ?? null;
            const fitness = player?.fitness ?? null;
            const morale = player?.morale ?? null;
            const topChampion = player
              ? topMasteryChampionByPlayerId.get(player.id)
                ?? TOP_CHAMPION_BY_IGN.get(normalizeKey(player.match_name))
                ?? fallbackChampionForRole(player.id, role)
                ?? ""
              : "";
            const canonicalKey = topChampion ? normalizeChampionKey(topChampion) : "";
            const championSplash = canonicalKey
              ? resolveChampionSplash(canonicalKey)
              : null;

            return (
              <div
                key={role}
                className={`relative overflow-hidden rounded-md border border-gray-100 dark:border-navy-600 bg-gray-50 dark:bg-navy-800/40 p-2 animate-fade-in-up delay-${(index % 5) * 100 + 100}`}
              >
                {championSplash ? (
                  <>
                    <div
                      className="absolute inset-0 opacity-35 bg-cover bg-center"
                      style={{ backgroundImage: `url(${championSplash})` }}
                    />
                    <div className="absolute inset-0 bg-linear-to-b from-black/35 via-black/55 to-black/75" />
                  </>
                ) : null}

                <div className="relative z-10">
                <p className="text-2xs font-heading font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {role}
                </p>

                <div className="mt-2 flex items-center gap-2">
                  {photo ? (
                    <img
                      src={photo}
                      alt={player?.match_name ?? role}
                      className="w-8 h-8 rounded-full object-cover border border-white/15"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-navy-700 border border-white/10" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-heading font-bold truncate text-gray-800 dark:text-gray-100">
                      {player?.match_name ?? "—"}
                    </p>
                    <p className="text-2xs text-gray-500 dark:text-gray-400">
                      {t("common.ovr")} {ovr ?? "—"}
                    </p>
                    {topChampion ? (
                      <p className="text-2xs text-primary-300 truncate">{topChampion}</p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1 text-2xs">
                  <div className="rounded bg-navy-900/60 px-1.5 py-1 text-center">
                    <p className="text-gray-400">{t("common.condition")}</p>
                    <p className="font-heading font-bold text-primary-400">
                      {condition !== null ? `${condition}%` : "—"}
                    </p>
                  </div>
                  <div className="rounded bg-navy-900/60 px-1.5 py-1 text-center">
                    <p className="text-gray-400">{t("common.fitness")}</p>
                    <p className="font-heading font-bold text-green-400">
                      {fitness !== null ? `${fitness}%` : "—"}
                    </p>
                  </div>
                  <div className="rounded bg-navy-900/60 px-1.5 py-1 text-center">
                    <p className="text-gray-400">{t("common.morale")}</p>
                    <p className="font-heading font-bold text-accent-400">
                      {morale !== null ? `${morale}%` : "—"}
                    </p>
                  </div>
                </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

