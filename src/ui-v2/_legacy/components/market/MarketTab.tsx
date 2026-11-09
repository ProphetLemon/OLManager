import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

import type { GameStateData } from "@/store/gameStore";
import { formatVal, getTeamName } from "@/lib/common/helpers";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { resolveTransferTeamLogo } from "@/lib/teams/transferLogos";

interface IncludedPlayerData {
  player_id: string;
  player_name: string;
  player_ovr: number;
  player_position: string;
  player_profile_image_url: string | null;
  valuation: number;
}

interface TransferHistoryEntryData {
  id: string;
  player_id: string;
  player_name: string;
  player_ovr: number;
  player_position: string;
  player_profile_image_url: string | null;
  from_team_id: string;
  from_team_name: string;
  to_team_id: string;
  to_team_name: string;
  fee: number;
  annual_wage: number;
  contract_years: number;
  date: string;
  is_user_involved: boolean;
  is_user_buying: boolean;
  was_negotiated: boolean;
  initial_offer_fee: number | null;
  negotiation_rounds: number;
  included_players: IncludedPlayerData[];
}

interface MarketTabProps {
  gameState: GameStateData;
}

type FilterType = "all" | "user" | "ai";

export default function MarketTab({ gameState }: MarketTabProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TransferHistoryEntryData[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");

  useEffect(() => {
    invoke<TransferHistoryEntryData[]>("get_transfer_history_cmd")
      .then((data) => setEntries(data))
      .catch(() => setEntries([]));
  }, [gameState]);

  const filtered = useMemo(() => {
    if (filter === "user") return entries.filter((e) => e.is_user_involved);
    if (filter === "ai") return entries.filter((e) => !e.is_user_involved);
    return entries;
  }, [entries, filter]);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-heading font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">
          {t("market.title")}
        </h2>
        <div className="flex gap-2">
          {(["all", "user", "ai"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-heading font-semibold uppercase tracking-wider transition-colors ${
                filter === f
                  ? "bg-primary-500 text-white"
                  : "bg-gray-100 dark:bg-navy-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-navy-600"
              }`}
            >
              {f === "all"
                ? t("market.filterAll")
                : f === "user"
                  ? t("market.filterMyTransfers")
                  : t("market.filterAiTransfers")}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-navy-700 bg-white/70 dark:bg-navy-900/40 p-6 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("market.empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => {
            const isFreeAgent = entry.from_team_id === "";
            const playerPhoto = resolvePlayerPhoto(
              entry.player_id,
              entry.player_name,
              entry.player_profile_image_url,
            );
            const fromTeamLogo = isFreeAgent
              ? null
              : resolveTransferTeamLogo(gameState?.teams, entry.from_team_id, entry.from_team_name);
            const toTeamLogo = resolveTransferTeamLogo(gameState?.teams, entry.to_team_id, entry.to_team_name);

            return (
              <div
                key={entry.id}
                className={`rounded-lg border p-3 transition-colors ${
                  entry.is_user_involved
                    ? "border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10"
                    : "border-gray-200 dark:border-navy-700 bg-white/70 dark:bg-navy-900/40"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={playerPhoto ?? undefined}
                      alt={entry.player_name}
                      className="w-12 h-12 rounded-lg object-cover shrink-0 bg-gray-100 dark:bg-navy-700"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          "/player-photos/107455908655055017.png";
                      }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                        {entry.player_name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {!isFreeAgent && (
                          <>
                            <img
                              src={fromTeamLogo ?? undefined}
                              alt={entry.from_team_name}
                              className="w-4 h-4 rounded object-contain bg-gray-100 dark:bg-navy-700"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display =
                                  "none";
                              }}
                            />
                            <span className="truncate">
                              {getTeamName(
                                gameState?.teams ?? [],
                                entry.from_team_id,
                              ) || entry.from_team_name}
                            </span>
                          </>
                        )}
                        {isFreeAgent && (
                          <span className="text-green-500 dark:text-green-400">
                            {t("market.freeAgent")}
                          </span>
                        )}
                        <span className="text-gray-300 dark:text-gray-600">→</span>
                        <img
                          src={toTeamLogo ?? undefined}
                          alt={entry.to_team_name}
                          className="w-4 h-4 rounded object-contain bg-gray-100 dark:bg-navy-700"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                        <span className="truncate">
                          {getTeamName(
                            gameState?.teams ?? [],
                            entry.to_team_id,
                          ) || entry.to_team_name}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-200">
                      {entry.fee > 0 ? formatVal(entry.fee) : t("market.freeAgent")}
                    </p>
                    <p className="text-caption text-gray-400">
                      {formatDate(entry.date)}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-3 text-caption text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-navy-700 pt-2">
                  <span>
                    {t("market.wage")}: {formatVal(entry.annual_wage)}/yr
                  </span>
                  {entry.contract_years > 0 && (
                    <span>
                      {t("market.contract")}: {entry.contract_years}{" "}
                      {t("market.years")}
                    </span>
                  )}
                  {entry.was_negotiated && entry.negotiation_rounds > 1 && (
                    <span>
                      {t("market.negotiated")}: {entry.negotiation_rounds}{" "}
                      {t("market.rounds")}
                    </span>
                  )}
                  {entry.is_user_involved && (
                    <span
                      className={`font-semibold ${
                        entry.is_user_buying
                          ? "text-green-500"
                          : "text-amber-500"
                      }`}
                    >
                      {entry.is_user_buying
                        ? t("market.youBought")
                        : t("market.youSold")}
                    </span>
                  )}
                </div>

                {entry.included_players && entry.included_players.length > 0 && (
                  <div className="mt-2 border-t border-gray-100 dark:border-navy-700 pt-2">
                    <p className="text-caption font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                      {t("market.includedPlayers")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {entry.included_players.map((inc) => {
                        const incPhoto = resolvePlayerPhoto(
                          inc.player_id,
                          inc.player_name,
                          inc.player_profile_image_url,
                        );
                        const incToTeamLogo = resolveTransferTeamLogo(
                          gameState?.teams,
                          entry.from_team_id,
                          entry.from_team_name,
                        );
                        return (
                          <div
                            key={inc.player_id}
                            className="flex items-center gap-2 px-2 py-1 rounded-md bg-gray-50 dark:bg-navy-800 border border-gray-200 dark:border-navy-700"
                          >
                            <img
                              src={incPhoto ?? undefined}
                              alt={inc.player_name}
                              className="w-6 h-6 rounded object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src =
                                  "/player-photos/107455908655055017.png";
                              }}
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                                {inc.player_name}
                              </p>
                              <div className="flex items-center gap-1 text-2xs text-gray-400 dark:text-gray-500">
                                <span className="text-gray-300 dark:text-gray-600">→</span>
                                <img
                                  src={incToTeamLogo ?? undefined}
                                  alt={entry.from_team_name}
                                  className="w-3 h-3 rounded object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display =
                                      "none";
                                  }}
                                />
                                <span className="truncate">
                                  {entry.from_team_name}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


