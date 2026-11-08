import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

import type { GameStateData } from "@/store/gameStore";
import { formatVal, getTeamName } from "@/lib/common/helpers";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { resolveTransferTeamLogo } from "@/lib/teams/transferLogos";
import { cn } from "@/ui-v2/lib/utils";

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

interface MarketTabV2Props {
  gameState: GameStateData;
}

type FilterType = "all" | "user" | "ai";

export function MarketTabV2({ gameState }: MarketTabV2Props) {
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
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-foreground">
          {t("market.title")}
        </h2>
        <div className="flex gap-2">
          {(["all", "user", "ai"] as FilterType[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3 py-1 font-heading text-xs font-semibold uppercase tracking-wider transition-colors",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted",
              )}
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
        <div className="rounded-lg border border-border bg-card/50 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("market.empty")}</p>
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
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  entry.is_user_involved
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card/50",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={playerPhoto ?? undefined}
                      alt={entry.player_name}
                      className="size-12 shrink-0 rounded-lg bg-muted object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          "/player-photos/107455908655055017.png";
                      }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {entry.player_name}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {!isFreeAgent && (
                          <>
                            <img
                              src={fromTeamLogo ?? undefined}
                              alt={entry.from_team_name}
                              className="size-4 rounded bg-muted object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                            <span className="truncate">
                              {getTeamName(gameState?.teams ?? [], entry.from_team_id) ||
                                entry.from_team_name}
                            </span>
                          </>
                        )}
                        {isFreeAgent && (
                          <span className="text-emerald-500">{t("market.freeAgent")}</span>
                        )}
                        <span className="text-muted-foreground/50">→</span>
                        <img
                          src={toTeamLogo ?? undefined}
                          alt={entry.to_team_name}
                          className="size-4 rounded bg-muted object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <span className="truncate">
                          {getTeamName(gameState?.teams ?? [], entry.to_team_id) ||
                            entry.to_team_name}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-foreground">
                      {entry.fee > 0 ? formatVal(entry.fee) : t("market.freeAgent")}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">
                      {formatDate(entry.date)}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <span>
                    {t("market.wage")}: {formatVal(entry.annual_wage)}/yr
                  </span>
                  {entry.contract_years > 0 && (
                    <span>
                      {t("market.contract")}: {entry.contract_years} {t("market.years")}
                    </span>
                  )}
                  {entry.was_negotiated && entry.negotiation_rounds > 1 && (
                    <span>
                      {t("market.negotiated")}: {entry.negotiation_rounds} {t("market.rounds")}
                    </span>
                  )}
                  {entry.is_user_involved && (
                    <span
                      className={cn(
                        "font-semibold",
                        entry.is_user_buying ? "text-emerald-500" : "text-amber-500",
                      )}
                    >
                      {entry.is_user_buying ? t("market.youBought") : t("market.youSold")}
                    </span>
                  )}
                </div>

                {entry.included_players && entry.included_players.length > 0 && (
                  <div className="mt-2 border-t border-border pt-2">
                    <p className="mb-1.5 font-heading text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                            className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1"
                          >
                            <img
                              src={incPhoto ?? undefined}
                              alt={inc.player_name}
                              className="size-6 rounded object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src =
                                  "/player-photos/107455908655055017.png";
                              }}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-foreground">
                                {inc.player_name}
                              </p>
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span className="text-muted-foreground/50">→</span>
                                <img
                                  src={incToTeamLogo ?? undefined}
                                  alt={entry.from_team_name}
                                  className="size-3 rounded object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                                <span className="truncate">{entry.from_team_name}</span>
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
