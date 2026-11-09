import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  GameStateData,
  PlayerData,
  PlayerSelectionOptions,
} from "@/store/gameStore";
import { Card } from "@/ui-v2/_legacy/components/ui";
import { AlertTriangle, ChevronRight, Repeat, ShoppingCart, User } from "lucide-react";
import { calcAge, formatVal } from "@/lib/common/helpers";
import { useTranslation } from "react-i18next";
import ContextMenu from "@/ui-v2/_legacy/components/ContextMenu";
import {
  buildActiveLineupIds,
  buildActiveLineupSlots,
  isPlayerOutOfPosition,
  LOL_ACTIVE_ROLES,
  LOL_ROLE_LABELS,
} from "@/ui-v2/_legacy/components/squad/SquadTab.helpers";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { PlayerAvatar } from "@/ui-v2/_legacy/components/ui/PlayerAvatar";
import { resolvePlayerLolRole } from "@/lib/players/lolIdentity";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";

type LolRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";
type SortKey = "pos" | "ovr" | "condition" | "fitness" | "morale" | "age";

const LOL_ROLE_ORDER: Record<LolRole, number> = {
  TOP: 1,
  JUNGLE: 2,
  MID: 3,
  ADC: 4,
  SUPPORT: 5,
};

const ROLE_LABEL: Record<LolRole, string> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUPPORT",
};

const ROLE_ICON_URLS: Record<string, string> = {
  TOP: ROLE_ICON_PATHS.TOP,
  JUNGLE: ROLE_ICON_PATHS.JUNGLE,
  MID: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  SUPPORT: ROLE_ICON_PATHS.SUPPORT,
};

function resolveRole(player: PlayerData): LolRole {
  return resolvePlayerLolRole(player);
}

function clampBar(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatContractMonth(date: string | null): string {
  if (!date) return "—";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("es-ES", { month: "short", year: "numeric" })
    .format(parsed)
    .replace(".", "");
}

interface SquadRosterViewProps {
  gameState: GameStateData;
  managerId: string;
  onGameUpdate?: (g: GameStateData) => void;
  onSelectPlayer: (id: string, options?: PlayerSelectionOptions) => void;
}

export default function SquadRosterView({
  gameState,
  managerId,
  onGameUpdate,
  onSelectPlayer,
}: SquadRosterViewProps) {
  const { t } = useTranslation();
  const myTeam = gameState.teams.find((team) => team.manager_id === managerId);
  const [sortKey, setSortKey] = useState<SortKey>("pos");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  if (!myTeam) {
    return <p className="text-gray-500 dark:text-gray-400">{t("common.unemployed")}</p>;
  }

  const roster = gameState.players.filter((player) => player.team_id === myTeam.id);
  const activeLineupIds = buildActiveLineupIds(roster, myTeam.active_lineup_ids ?? myTeam.starting_xi_ids ?? []);
  const activeIds = new Set(activeLineupIds);
  const playersById = useMemo(
    () => new Map(roster.map((player) => [player.id, player])),
    [roster],
  );
  const activeLineupSlots = useMemo(
    () => buildActiveLineupSlots(LOL_ACTIVE_ROLES, activeLineupIds, playersById),
    [activeLineupIds, playersById],
  );

  const sortedRoster = useMemo(() => {
    const sorted = [...roster].sort((a, b) => {
      switch (sortKey) {
        case "pos":
          return LOL_ROLE_ORDER[resolveRole(a)] - LOL_ROLE_ORDER[resolveRole(b)] || calculateLolOvr(b) - calculateLolOvr(a);
        case "ovr":
          return calculateLolOvr(a) - calculateLolOvr(b);
        case "condition":
          return a.condition - b.condition;
        case "fitness":
          return (a.fitness ?? 75) - (b.fitness ?? 75);
        case "morale":
          return a.morale - b.morale;
        case "age":
          return calcAge(a.date_of_birth, gameState.clock.current_date) - calcAge(b.date_of_birth, gameState.clock.current_date);
        default:
          return 0;
      }
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [gameState.clock.current_date, roster, sortDir, sortKey]);

  const toggleSort = (nextKey: SortKey): void => {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "ovr" ? "desc" : "asc");
  };

  return (
    <div className="w-[92%] max-w-[2000px] mx-auto flex flex-col gap-4">
      <Card>
        <div className="p-4 border-b border-navy-600 bg-navy-900 rounded-t-xl">
          <h3 className="text-sm font-heading font-bold text-blue-100 uppercase tracking-wide">
            {t("squad.activeLineup", { defaultValue: "Active Lineup" })}
          </h3>
          <p className="mt-1 text-xs text-blue-200/70">
            {t("squad.activeLineupHint", { defaultValue: "Core five-player League of Legends lineup." })}
          </p>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-5 gap-3 p-3 md:p-4 bg-navy-950 rounded-b-xl"
          data-testid="active-lineup"
        >
          {activeLineupSlots.map((slot) => {
            const player = slot.player;
            const roleLabel = LOL_ROLE_LABELS[slot.role];
            const ovr = player ? calculateLolOvr(player) : null;
            const photo = player ? resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url) : null;

            return (
              <button
                key={slot.role}
                className="min-h-32 rounded-xl border border-navy-600 bg-navy-800 px-3 py-3 text-left hover:bg-navy-750 transition-colors disabled:cursor-default disabled:hover:bg-navy-800"
                data-testid={`active-lineup-role-${slot.role}`}
                disabled={!player}
                onClick={() => {
                  if (player) onSelectPlayer(player.id);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-heading font-black tracking-widest text-amber-300">{roleLabel}</span>
                  <img src={ROLE_ICON_URLS[slot.role]} alt={roleLabel} className="w-5 h-5 object-contain opacity-90" />
                </div>

                {player ? (
                  <div className="mt-3 flex items-center gap-3">
                    <PlayerAvatar src={photo} alt={player.match_name} className="w-10 h-10" />
                    <div className="min-w-0">
                      <p className="text-lg leading-none font-heading font-bold text-white truncate">{player.match_name}</p>
                      <p className="mt-1 text-xs text-blue-200/70">{t("common.ovr", { defaultValue: "OVR" })} {ovr}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
                    <p className="text-xs font-heading font-bold uppercase tracking-wide text-amber-300">
                      {t("squad.missingRoleCoverage", { defaultValue: "Missing role coverage" })}
                    </p>
                    <p className="mt-1 text-xs text-amber-100/80">
                      {t("squad.noRoleAvailable", { defaultValue: `No ${roleLabel} available` })}
                    </p>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="p-4 border-b border-navy-600 bg-navy-900 rounded-t-xl">
          <h3 className="text-sm font-heading font-bold text-blue-100 uppercase tracking-wide">
            {t("squad.benchSubstitutes", { defaultValue: "Bench / Substitutes" })}
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              ["pos", t("squad.pos", { defaultValue: "Posición" })],
              ["ovr", t("common.ovr", { defaultValue: "OVR" })],
              ["condition", t("common.condition", { defaultValue: "Energía" })],
              ["fitness", t("common.fitness", { defaultValue: "Fitness" })],
              ["morale", t("common.morale", { defaultValue: "Moral" })],
              ["age", t("common.age", { defaultValue: "Edad" })],
            ] as Array<[SortKey, string]>).map(([key, label]) => (
              <button
                key={key}
                className={`px-2.5 py-1 rounded-md text-xs font-heading font-bold uppercase tracking-wide border transition-colors ${
                  sortKey === key
                    ? "bg-primary-500/15 border-primary-400 text-primary-300"
                    : "bg-navy-850 border-navy-500 text-blue-200/80 hover:border-primary-400"
                }`}
                onClick={() => toggleSort(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 md:p-4 space-y-2 bg-navy-950 rounded-b-xl">
          {sortedRoster.map((player) => {
            const role = resolveRole(player);
            const ovr = calculateLolOvr(player);
            const photo = resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url);
            const inXI = activeIds.has(player.id);
            const currentPos = player.position;
            const wrongPos = inXI && isPlayerOutOfPosition(player, currentPos);
            const annualWage = player.wage;

            const contextItems = [
              {
                label: t("squad.viewProfile", { defaultValue: "Ver perfil" }),
                icon: <User className="w-4 h-4" />,
                onClick: () => onSelectPlayer(player.id),
              },
              {
                label: "",
                icon: undefined,
                onClick: () => {},
                divider: true,
              },
              {
                label: player.transfer_listed
                  ? t("squad.removeFromTransferList", { defaultValue: "Quitar de transferibles" })
                  : t("squad.addToTransferList", { defaultValue: "Añadir a transferibles" }),
                icon: <ShoppingCart className="w-4 h-4" />,
                onClick: async () => {
                  try {
                    const updated = await invoke<GameStateData>("toggle_transfer_list", { playerId: player.id });
                    onGameUpdate?.(updated);
                  } catch {
                    return;
                  }
                },
              },
              {
                label: player.loan_listed
                  ? t("squad.removeFromLoanList", { defaultValue: "Quitar de cesión" })
                  : t("squad.addToLoanList", { defaultValue: "Añadir a cesión" }),
                icon: <Repeat className="w-4 h-4" />,
                onClick: async () => {
                  try {
                    const updated = await invoke<GameStateData>("toggle_loan_list", { playerId: player.id });
                    onGameUpdate?.(updated);
                  } catch {
                    return;
                  }
                },
              },
            ];

            return (
              <ContextMenu items={contextItems} key={player.id}>
                <button
                  className="w-full text-left rounded-xl border border-navy-600 bg-navy-800 hover:bg-navy-750 transition-colors px-3 py-2.5"
                  onClick={() => onSelectPlayer(player.id)}
                >
                  <div className="grid grid-cols-1 xl:grid-cols-[34px_44px_minmax(220px,1fr)_72px_72px_170px_170px_170px_110px_90px] items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-navy-850 border border-white/10 flex items-center justify-center">
                      <img src={ROLE_ICON_URLS[role]} alt={ROLE_LABEL[role]} className="w-4 h-4 object-contain opacity-90" />
                    </div>

                    <PlayerAvatar src={photo} alt={player.match_name} className="w-10 h-10" />

                    <div className="min-w-0 flex items-center gap-2">
                      <div className="min-w-0">
                        <p className="text-3xl leading-none font-heading font-black text-amber-300 xl:hidden">{ovr}</p>
                        <p className="text-xl leading-none font-heading font-bold text-white truncate">{player.match_name}</p>
                        <p className="text-xs text-blue-200/70 truncate">{player.full_name}</p>
                        <p className="text-xs uppercase tracking-wide text-blue-200/70 xl:hidden">{ROLE_LABEL[role]}</p>
                      </div>
                      {wrongPos ? (
                        <span className="text-amber-400 shrink-0" title={t("squad.outOfPositionTooltip", { defaultValue: "Fuera de rol" })}>
                          <AlertTriangle className="w-4 h-4" />
                        </span>
                      ) : null}
                    </div>

                    <div className="hidden xl:block text-center">
                      <p className="text-3xl leading-none font-heading font-black text-amber-300">{ovr}</p>
                      <p className="text-xs uppercase tracking-wide text-blue-200/65">{t("common.ovr")}</p>
                    </div>

                    <div className="hidden xl:flex items-center justify-center">
                      <img
                        src={ROLE_ICON_URLS[role]}
                        alt={ROLE_LABEL[role]}
                        className="w-8 h-8 object-contain opacity-90"
                      />
                    </div>

                    <div className="hidden xl:block min-w-36">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-2xs uppercase tracking-wide text-blue-200/60">{t("common.morale")}</p>
                        <p className="text-caption font-heading font-bold text-emerald-300">{player.morale}</p>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-navy-950 overflow-hidden">
                        <div className="h-full bg-emerald-400" style={{ width: `${clampBar(player.morale)}%` }} />
                      </div>
                    </div>

                    <div className="hidden xl:block min-w-36">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-2xs uppercase tracking-wide text-blue-200/60">{t("common.condition")}</p>
                        <p className="text-caption font-heading font-bold text-amber-300">{player.condition}</p>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-navy-950 overflow-hidden">
                        <div className="h-full bg-amber-400" style={{ width: `${clampBar(player.condition)}%` }} />
                      </div>
                    </div>

                    <div className="hidden xl:block min-w-36">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-2xs uppercase tracking-wide text-blue-200/60">{t("common.fitness")}</p>
                        <p className="text-caption font-heading font-bold text-green-300">{player.fitness ?? 75}</p>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-navy-950 overflow-hidden">
                        <div className="h-full bg-green-400" style={{ width: `${clampBar(player.fitness ?? 75)}%` }} />
                      </div>
                    </div>

                    <div className="hidden xl:block text-right min-w-24">
                      <p className="text-sm font-heading font-bold text-white">{formatVal(annualWage)}</p>
                      <p className="text-caption text-blue-200/60">{t("common.per_year_with_slash")}</p>
                    </div>

                    <div className="hidden xl:flex items-center justify-end gap-2 min-w-24 text-blue-200/70">
                      <span className="text-sm">{formatContractMonth(player.contract_end)}</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>

                    <div className="xl:hidden mt-2 grid grid-cols-3 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-2xs uppercase tracking-wide text-blue-200/60">{t("common.morale")}</p>
                          <p className="text-xs font-heading font-bold text-emerald-300">{player.morale}</p>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-navy-950 overflow-hidden">
                          <div className="h-full bg-emerald-400" style={{ width: `${clampBar(player.morale)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-2xs uppercase tracking-wide text-blue-200/60">{t("common.condition")}</p>
                          <p className="text-xs font-heading font-bold text-amber-300">{player.condition}</p>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-navy-950 overflow-hidden">
                          <div className="h-full bg-amber-400" style={{ width: `${clampBar(player.condition)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-2xs uppercase tracking-wide text-blue-200/60">{t("common.fitness")}</p>
                          <p className="text-xs font-heading font-bold text-green-300">{player.fitness ?? 75}</p>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-navy-950 overflow-hidden">
                          <div className="h-full bg-green-400" style={{ width: `${clampBar(player.fitness ?? 75)}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              </ContextMenu>
            );
          })}

          {sortedRoster.length === 0 ? (
            <div className="p-8 text-center text-blue-200/70 font-heading uppercase tracking-wider text-sm">
              {t("squad.noPlayers", { defaultValue: "Sin jugadores" })}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

