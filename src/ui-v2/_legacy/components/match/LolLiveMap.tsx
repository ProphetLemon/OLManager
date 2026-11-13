import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import {
  JUNGLE_CAMPS_LAYOUT,
  JUNGLE_CAMP_ICON_PATH,
  NEUTRAL_OBJECTIVES_LAYOUT,
  NEUTRAL_OBJECTIVE_ICON_PATH,
  STRUCTURES_LAYOUT,
  STRUCTURE_ICON_PATH,
} from "@/lib/match/lolMapLayout";
import type { ChampionSelectionByPlayer } from "@/ui-v2/match/live/useChampionProfiles";
import { useTranslation } from "react-i18next";

interface LolLiveMapProps {
  snapshot: MatchSnapshot;
  championSelections?: ChampionSelectionByPlayer | null;
}

function objectiveAlive(snapshot: MatchSnapshot, id: string): boolean {
  const lolMap = snapshot.lol_map;
  if (!lolMap) return true;
  if (id === "baron-pit") return lolMap.objectives.baron.alive;
  if (id === "dragon-pit") return lolMap.objectives.dragon.alive;
  if (id === "grub-pit") return lolMap.objectives.grubs.alive;
  if (id === "herald-area") return lolMap.objectives.herald.alive;
  return true;
}

function structureAlive(snapshot: MatchSnapshot, id: string): boolean {
  const map = snapshot.lol_map;
  if (!map) return true;

  const side = id.startsWith("blue-") ? map.blue : map.red;
  if (id.includes("top-outer")) return side.top.outer_alive;
  if (id.includes("top-inner")) return side.top.inner_alive;
  if (id.includes("top-inhib-tower")) return side.top.inhibitor_alive;
  if (id.includes("mid-outer")) return side.mid.outer_alive;
  if (id.includes("mid-inner")) return side.mid.inner_alive;
  if (id.includes("mid-inhib-tower")) return side.mid.inhibitor_alive;
  if (id.includes("bot-outer")) return side.bot.outer_alive;
  if (id.includes("bot-inner")) return side.bot.inner_alive;
  if (id.includes("bot-inhib-tower")) return side.bot.inhibitor_alive;
  if (id.includes("nexus-top-tower")) return side.nexus_tower_top_alive;
  if (id.includes("nexus-bot-tower")) return side.nexus_tower_bot_alive;
  if (id.includes("nexus") && !id.includes("tower")) return side.nexus_alive;
  return true;
}

function championIconUrl(championId: string | undefined): string | null {
  if (!championId) return null;
  return `/champion-tiles/${championId}.webp`;
}

function initials(name: string): string {
  const chunks = name.trim().split(/\s+/).filter(Boolean);
  if (chunks.length >= 2) return `${chunks[0][0]}${chunks[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function LolLiveMap({ snapshot, championSelections }: LolLiveMapProps) {
  const { t } = useTranslation();
  const units = snapshot.lol_map?.units ?? [];

  const playerNameById = new Map<string, string>();
  snapshot.home_team.players.forEach((player) => playerNameById.set(player.id, player.name));
  snapshot.away_team.players.forEach((player) => playerNameById.set(player.id, player.name));

  const jungleCamps = JUNGLE_CAMPS_LAYOUT;

  return (
    <div className="h-full w-full overflow-auto">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
          <span className="font-heading uppercase tracking-wider">
            {t("match.liveMap.teamBlue", { team: snapshot.home_team.name })}
          </span>
          <span className="font-heading uppercase tracking-wider">
            {t("match.liveMap.teamRed", { team: snapshot.away_team.name })}
          </span>
        </div>

        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-gray-200 bg-black shadow-xl dark:border-navy-600">
          <img
            src="/map.webp"
            alt={t("match.liveMap.mapAlt")}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />

          {STRUCTURES_LAYOUT.map((point) => (
            structureAlive(snapshot, point.id) ? (
              <div
                key={point.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                title={point.label}
              >
                <img
                  src={STRUCTURE_ICON_PATH[point.icon]}
                  alt={point.label}
                  width={40}
                  height={40}
                  className="pointer-events-none select-none drop-shadow-[0_0_8px_rgba(255,255,255,0.35)]"
                  draggable={false}
                />
              </div>
            ) : null
          ))}

          {NEUTRAL_OBJECTIVES_LAYOUT.map((point) => (
            objectiveAlive(snapshot, point.id) ? (
              <div
                key={point.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                title={point.label}
              >
                <img
                  src={NEUTRAL_OBJECTIVE_ICON_PATH[point.icon]}
                  alt={point.label}
                  width={48}
                  height={48}
                  className="pointer-events-none select-none drop-shadow-[0_0_8px_rgba(250,204,21,0.45)]"
                  draggable={false}
                />
              </div>
            ) : null
          ))}

          {jungleCamps.map((camp) => (
            <div
              key={camp.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${camp.x * 100}%`, top: `${camp.y * 100}%` }}
              title={camp.label}
            >
              <img
                src={JUNGLE_CAMP_ICON_PATH[camp.icon]}
                alt={camp.label}
                width={36}
                height={36}
                className="pointer-events-none select-none drop-shadow-[0_0_8px_rgba(163,230,53,0.45)]"
                draggable={false}
              />
            </div>
          ))}

          {units.map((unit) => {
            const isBlue = unit.side === "Home";
            const championId = isBlue
              ? championSelections?.home?.[unit.player_id]
              : championSelections?.away?.[unit.player_id];
            const icon = championIconUrl(championId);
            const label = playerNameById.get(unit.player_id) ?? unit.player_id;
            const respawnLeft = unit.alive || unit.respawn_minute == null
              ? null
              : Math.max(0, unit.respawn_minute - snapshot.current_minute);

            return (
              <div
                key={unit.player_id}
                className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-200 ease-linear"
                style={{ left: `${unit.x * 100}%`, top: `${unit.y * 100}%` }}
                title={`${label} · ${unit.role} · ${unit.task}`}
              >
                <div
                  className={`relative w-7 h-7 rounded-full border-2 text-2xs font-heading font-bold flex items-center justify-center text-white ${
                    isBlue
                      ? "bg-cyan-600 border-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.65)]"
                      : "bg-rose-600 border-rose-300 shadow-[0_0_10px_rgba(251,113,133,0.65)]"
                  } ${unit.alive ? "" : "grayscale opacity-70"}`}
                >
                  {icon ? (
                    <img src={icon} alt={label} className="w-full h-full rounded-full object-cover" draggable={false} />
                  ) : (
                    initials(label)
                  )}

                  {!unit.alive ? (
                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-black/85 border border-white/20 text-2xs leading-4 text-center text-white">
                      {respawnLeft ?? "X"}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {snapshot.lol_map ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-700 dark:text-gray-300">
            <div className="rounded border border-gray-200 px-2 py-1 dark:border-navy-600">
              <p className="font-heading uppercase tracking-wider text-2xs text-gray-500 dark:text-gray-400">{t("match.liveMap.dragon")}</p>
              <p>
                {snapshot.lol_map.objectives.dragon.alive
                  ? t("match.liveMap.aliveWithKind", {
                    kind: snapshot.lol_map.objectives.dragon.current_kind ?? t("match.liveMap.elemental"),
                  })
                  : t("match.liveMap.respawn", {
                    minute: snapshot.lol_map.objectives.dragon.next_spawn_minute ?? "—",
                  })}
              </p>
            </div>
            <div className="rounded border border-gray-200 px-2 py-1 dark:border-navy-600">
              <p className="font-heading uppercase tracking-wider text-2xs text-gray-500 dark:text-gray-400">{t("match.liveMap.baron")}</p>
              <p>
                {snapshot.lol_map.objectives.baron.alive
                  ? t("match.liveMap.alive")
                  : t("match.liveMap.respawn", {
                    minute: snapshot.lol_map.objectives.baron.next_spawn_minute ?? "—",
                  })}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

