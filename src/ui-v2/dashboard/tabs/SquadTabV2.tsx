import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, ArrowDown, ArrowUp, Search } from "lucide-react";

import type { GameStateData, PlayerData, PlayerSelectionOptions } from "@/store/gameStore";
import {
  buildActiveLineupIds,
  buildActiveLineupSlots,
  isPlayerOutOfPosition,
  LOL_ACTIVE_ROLES,
} from "@/lib/squad/helpers";
import {
  MAX_IMPORTS_IN_STARTING_FIVE,
  countImports,
  parseImportLimitError,
  wouldExceedImportLimit,
} from "@/lib/squad/imports";
import { getPlayerCardModel, shortRoleKey, type PlayerCardModel } from "@/lib/squad/cards";
import type { LolRole } from "@/lib/home/scoreboard";

import { Card, CardContent } from "@/ui-v2/components/ui/card";
import { SegmentedControl } from "@/ui-v2/components/ui/segmented-control";
import { cn } from "@/ui-v2/lib/utils";

import { BenchEmptyState } from "./squad/BenchEmptyState";
import { BenchRow } from "./squad/BenchRow";
import { EmptySlotCard } from "./squad/EmptySlotCard";
import { PlayerCardV2, ROLE_DEFAULT, type SwapCandidate } from "./squad/PlayerCardV2";
import { SelectedPlayerBar } from "./squad/SelectedPlayerBar";
import { StartingFiveGrid } from "./squad/StartingFiveGrid";

// ─── Types ──────────────────────────────────────────────────────

type SortKey = "pos" | "ovr" | "condition" | "fitness" | "morale" | "age";
type RoleFilter = "all" | LolRole;

const LOL_ROLE_ORDER: Record<LolRole, number> = {
  TOP: 1,
  JUNGLE: 2,
  MID: 3,
  ADC: 4,
  SUPPORT: 5,
};

const EMPTY_IDS: string[] = [];

// ─── Props ──────────────────────────────────────────────────────

interface SquadTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (g: GameStateData) => void;
  onSelectPlayer: (id: string, options?: PlayerSelectionOptions) => void;
  /** Used by the empty-bench actions (market, academy). They do nothing when omitted. */
  onNavigate?: (tab: string) => void;
}

// ─── Component ──────────────────────────────────────────────────

export function SquadTabV2({
  gameState,
  onGameUpdate,
  onSelectPlayer,
  onNavigate,
}: SquadTabV2Props) {
  const { t, i18n } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey>("pos");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [lineupNotice, setLineupNotice] = useState<string | null>(null);
  const autoSaveChecked = useRef(false);

  // Every hook lives above the unemployed early return, so the hook order is
  // identical whether or not the manager has a team.
  const myTeam = useMemo(
    () => gameState.teams.find((tm) => tm.id === gameState.manager.team_id),
    [gameState.teams, gameState.manager.team_id],
  );
  const roster = useMemo(
    () => (myTeam ? gameState.players.filter((player) => player.team_id === myTeam.id) : []),
    [gameState.players, myTeam],
  );
  const storedIds = myTeam?.active_lineup_ids ?? myTeam?.starting_xi_ids ?? EMPTY_IDS;
  const activeLineupIds = useMemo(
    () => buildActiveLineupIds(roster, storedIds),
    [roster, storedIds],
  );
  const activeIds = useMemo(() => new Set(activeLineupIds), [activeLineupIds]);
  const playersById = useMemo(
    () => new Map(roster.map((player) => [player.id, player])),
    [roster],
  );
  const activeLineupSlots = useMemo(
    () => buildActiveLineupSlots(LOL_ACTIVE_ROLES, activeLineupIds, playersById),
    [activeLineupIds, playersById],
  );
  const models = useMemo(
    () =>
      new Map<string, PlayerCardModel>(
        roster.map((player) => [
          player.id,
          getPlayerCardModel(player, {
            currentDate: gameState.clock.current_date,
            locale: i18n.language,
          }),
        ]),
      ),
    [roster, gameState.clock.current_date, i18n.language],
  );

  // Persist the computed five once, when it differs from what the save holds
  // and every slot is filled.
  useEffect(() => {
    if (autoSaveChecked.current || !myTeam) return;
    autoSaveChecked.current = true;
    if (
      activeLineupIds.every(Boolean) &&
      JSON.stringify(storedIds) !== JSON.stringify(activeLineupIds)
    ) {
      invoke("set_active_lineup", { playerIds: activeLineupIds }).catch((e) =>
        console.warn("[SquadTab] auto-save lineup failed:", e),
      );
    }
  }, [myTeam, activeLineupIds, storedIds]);

  const sortedRoster = useMemo(() => {
    // Sort a copy: sorting `roster` in place would reorder the memoised lineup input.
    const sorted = [...roster].sort((a, b) => {
      const ma = models.get(a.id);
      const mb = models.get(b.id);
      if (!ma || !mb) return 0;
      switch (sortKey) {
        case "pos":
          return LOL_ROLE_ORDER[ma.role] - LOL_ROLE_ORDER[mb.role] || mb.ovr - ma.ovr;
        case "ovr":
          return ma.ovr - mb.ovr;
        case "condition":
          return ma.energy - mb.energy;
        case "fitness":
          return (ma.fitness ?? -1) - (mb.fitness ?? -1);
        case "morale":
          return ma.morale - mb.morale;
        case "age":
          return (ma.age ?? 0) - (mb.age ?? 0);
        default:
          return 0;
      }
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [roster, models, sortDir, sortKey]);

  const benchPlayers = useMemo(
    () => sortedRoster.filter((player) => !activeIds.has(player.id)),
    [sortedRoster, activeIds],
  );
  const benchRoleCounts = useMemo(() => {
    const counts: Record<LolRole, number> = { TOP: 0, JUNGLE: 0, MID: 0, ADC: 0, SUPPORT: 0 };
    benchPlayers.forEach((player) => {
      const model = models.get(player.id);
      if (model) counts[model.role] += 1;
    });
    return counts;
  }, [benchPlayers, models]);
  const benchVisible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return benchPlayers.filter((player) => {
      const model = models.get(player.id);
      if (!model) return false;
      if (roleFilter !== "all" && model.role !== roleFilter) return false;
      return query === "" || model.name.toLowerCase().includes(query);
    });
  }, [benchPlayers, models, roleFilter, search]);

  const starters = useMemo(
    () =>
      activeLineupIds
        .map((id) => playersById.get(id))
        .filter((player): player is PlayerData => player !== undefined),
    [activeLineupIds, playersById],
  );
  const lineupImports = countImports(starters);
  const filledSlots = activeLineupSlots.filter((slot) => slot.player).length;

  const lowestEnergyPlayer = useMemo(
    () =>
      roster.reduce<PlayerData | null>(
        (lowest, player) => (lowest === null || player.condition < lowest.condition ? player : lowest),
        null,
      ),
    [roster],
  );

  // Per-slot swap candidates: bench players, same-role first, then by rating.
  // An import that would break the two-import limit is listed but disabled.
  const candidatesBySlot = useMemo(() => {
    const importLimitReason = t("onAir.squad.importLimit", { defaultValue: "Import limit reached" });
    return activeLineupSlots.map((slot) => {
      const outgoingId = activeLineupIds[slot.index] || null;
      return [...benchPlayers]
        .sort((a, b) => {
          const ma = models.get(a.id);
          const mb = models.get(b.id);
          if (!ma || !mb) return 0;
          const aMatch = ma.role === slot.role ? 0 : 1;
          const bMatch = mb.role === slot.role ? 0 : 1;
          return aMatch - bMatch || mb.ovr - ma.ovr;
        })
        .map<SwapCandidate>((player) => {
          const model = models.get(player.id);
          const roleLabel = t(shortRoleKey(model?.role ?? slot.role), {
            defaultValue: ROLE_DEFAULT[model?.role ?? slot.role],
          });
          const blocked = wouldExceedImportLimit(starters, outgoingId, player);
          return {
            id: player.id,
            label: `${model?.name ?? player.match_name} - ${roleLabel} (${model?.ovr ?? 0})`,
            disabled: blocked,
            reason: blocked ? importLimitReason : undefined,
          };
        });
    });
  }, [activeLineupSlots, activeLineupIds, benchPlayers, models, starters, t]);

  const toggleSort = (nextKey: SortKey): void => {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "ovr" ? "desc" : "asc");
  };

  const handleToggleList = useCallback(
    async (command: "toggle_transfer_list" | "toggle_loan_list", playerId: string) => {
      try {
        const updated = await invoke<GameStateData>(command, { playerId });
        onGameUpdate(updated);
      } catch {
        /* silent */
      }
    },
    [onGameUpdate],
  );

  const handleSlotChange = useCallback(
    async (slotIndex: number, playerId: string) => {
      const incoming = playersById.get(playerId);
      const outgoingId = activeLineupIds[slotIndex] || null;
      if (incoming && wouldExceedImportLimit(starters, outgoingId, incoming)) {
        setLineupNotice(
          t("squad.tooManyImports", {
            count: MAX_IMPORTS_IN_STARTING_FIVE + 1,
            max: MAX_IMPORTS_IN_STARTING_FIVE,
          }),
        );
        return;
      }
      setLineupNotice(null);
      const newIds = [...activeLineupIds];
      newIds[slotIndex] = playerId;
      for (let i = 0; i < newIds.length; i++) {
        if (i !== slotIndex && newIds[i] === playerId) {
          newIds[i] = "";
        }
      }
      setSavingSlot(String(slotIndex));
      try {
        const updated = await invoke<GameStateData>("set_active_lineup", { playerIds: newIds });
        onGameUpdate(updated);
      } catch (err) {
        const refusal = parseImportLimitError(err);
        if (refusal) {
          setLineupNotice(t("squad.tooManyImports", { count: refusal.count, max: refusal.max }));
        }
        console.error("[SquadTab] Failed to set active lineup:", err);
      } finally {
        setSavingSlot(null);
      }
    },
    [activeLineupIds, onGameUpdate, playersById, starters, t],
  );

  // ─── Unemployed ──────────────────────────────────────────────────
  if (!myTeam) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-heading text-lg font-semibold text-muted-foreground">
              {t("common.unemployed", { defaultValue: "You are currently unemployed." })}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasRoster = roster.length > 0;
  const selectedModel =
    selectedId && activeIds.has(selectedId) ? (models.get(selectedId) ?? null) : null;
  const importsAtLimit = lineupImports >= MAX_IMPORTS_IN_STARTING_FIVE;

  const sortOptions: Array<[SortKey, string]> = [
    ["pos", t("squad.pos", { defaultValue: "Pos" })],
    ["ovr", t("common.ovr", { defaultValue: "OVR" })],
    ["condition", t("common.condition", { defaultValue: "Condition" })],
    ["fitness", t("common.fitness", { defaultValue: "Fitness" })],
    ["morale", t("common.morale", { defaultValue: "Morale" })],
    ["age", t("common.age", { defaultValue: "Age" })],
  ];
  const roleOptions = [
    {
      value: "all",
      label: t("onAir.squad.filterAllRoles", { defaultValue: "All roles" }),
      count: benchPlayers.length,
    },
    ...LOL_ACTIVE_ROLES.map((role) => ({
      value: role,
      label: t(shortRoleKey(role), { defaultValue: ROLE_DEFAULT[role] }),
      count: benchRoleCounts[role],
    })),
  ];

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto p-6 scrollbar-v2">
      {/* ── Starting five ─────────────────────────────────────── */}
      <section aria-labelledby="squad-lineup-title" className="flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-1">
            <h2 id="squad-lineup-title" className="font-heading text-section font-semibold uppercase">
              {t("onAir.squad.startingFive", { defaultValue: "Starting five" })}
            </h2>
            {hasRoster ? (
              <p className="text-sm text-muted-foreground tabular-nums">
                {t("onAir.squad.slotsFilled", {
                  count: filledSlots,
                  defaultValue: `${filledSlots} of 5 slots filled`,
                })}
              </p>
            ) : null}
          </div>
          {hasRoster ? (
            <p
              data-testid="lineup-import-count"
              className={cn(
                "flex items-center gap-1.5 text-sm tabular-nums",
                importsAtLimit ? "font-semibold text-warning" : "text-muted-foreground",
              )}
            >
              {importsAtLimit ? <AlertTriangle aria-hidden="true" className="size-4" /> : null}
              {t("squad.importsInLineup", {
                count: lineupImports,
                max: MAX_IMPORTS_IN_STARTING_FIVE,
              })}
            </p>
          ) : null}
        </header>

        {lineupNotice ? (
          <p
            role="alert"
            data-testid="lineup-import-notice"
            className="rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            {lineupNotice}
          </p>
        ) : null}

        {hasRoster && lowestEnergyPlayer && lowestEnergyPlayer.condition < 50 ? (
          <p className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            {t("onAir.squad.lowEnergy", {
              names: lowestEnergyPlayer.match_name,
              pct: lowestEnergyPlayer.condition,
              defaultValue: `${lowestEnergyPlayer.match_name}: energy ${lowestEnergyPlayer.condition}%`,
            })}
          </p>
        ) : null}

        {!hasRoster ? (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted-foreground">
            {t("squad.noPlayers", { defaultValue: "No players found in your squad." })}
          </p>
        ) : (
          <div data-testid="active-lineup">
            <StartingFiveGrid>
              {activeLineupSlots.map((slot) => {
                const player = slot.player;
                const model = player ? models.get(player.id) : undefined;
                const candidates = candidatesBySlot[slot.index] ?? [];
                const saving = savingSlot === String(slot.index);
                if (!player || !model) {
                  return (
                    <EmptySlotCard
                      key={slot.role}
                      slotRole={slot.role}
                      candidates={candidates}
                      saving={saving}
                      onFill={(id) => void handleSlotChange(slot.index, id)}
                    />
                  );
                }
                return (
                  <PlayerCardV2
                    key={slot.role}
                    model={model}
                    slotRole={slot.role}
                    selected={selectedId === player.id}
                    onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
                    candidates={candidates}
                    onSwap={(id) => void handleSlotChange(slot.index, id)}
                    saving={saving}
                    outOfPosition={isPlayerOutOfPosition(player, slot.role)}
                  />
                );
              })}
            </StartingFiveGrid>
          </div>
        )}

        {selectedModel ? (
          <SelectedPlayerBar
            model={selectedModel}
            onOpenProfile={(id) => onSelectPlayer(id)}
            onRenew={(id) => onSelectPlayer(id, { openRenewal: true })}
            onToggleTransferList={(id) => void handleToggleList("toggle_transfer_list", id)}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </section>

      {/* ── Bench ─────────────────────────────────────────────── */}
      {hasRoster ? (
        <section aria-labelledby="squad-bench-title" className="flex min-h-0 flex-col gap-4">
          <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2
              id="squad-bench-title"
              className="font-heading text-section font-semibold uppercase"
            >
              {t("onAir.squad.substitutes", { defaultValue: "Substitutes" })}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {t("onAir.squad.benchCount", {
                shown: benchVisible.length,
                total: benchPlayers.length,
                defaultValue: `${benchVisible.length} of ${benchPlayers.length}`,
              })}
            </p>
          </header>

          {benchPlayers.length > 0 ? (
            <div
              data-slot="bench-toolbar"
              className="flex flex-wrap items-center gap-x-3 gap-y-2"
            >
              <label className="relative block w-60 max-w-full">
                <span className="sr-only">
                  {t("squad.filterPlayers", {
                    defaultValue: "Filter by player name or position",
                  })}
                </span>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("onAir.squad.searchSubstitutes", {
                    defaultValue: "Search substitutes",
                  })}
                  className="min-h-[var(--hit)] w-full rounded-lg border border-border bg-background ps-9 pe-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
              </label>
              <div
                role="group"
                aria-label={t("onAir.squad.sortBy", { defaultValue: "Sort bench by" })}
                className="inline-flex flex-wrap overflow-hidden rounded-lg border border-border"
              >
                {sortOptions.map(([key, label]) => {
                  const active = sortKey === key
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSort(key)}
                      className={cn(
                        "inline-flex min-h-[var(--hit)] items-center gap-1 border-s border-border px-3 text-sm transition-colors first:border-s-0",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        active
                          ? "bg-club font-bold text-club-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {label}
                      {active ? (
                        <>
                          {sortDir === "asc" ? (
                            <ArrowUp aria-hidden="true" className="size-3.5" />
                          ) : (
                            <ArrowDown aria-hidden="true" className="size-3.5" />
                          )}
                          <span className="sr-only">
                            {sortDir === "asc"
                              ? t("onAir.squad.sortAscending", { defaultValue: "ascending" })
                              : t("onAir.squad.sortDescending", { defaultValue: "descending" })}
                          </span>
                        </>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              <SegmentedControl
                size="sm"
                ariaLabel={t("onAir.squad.roleFilter", { defaultValue: "Filter bench by role" })}
                value={roleFilter}
                onValueChange={(value) => setRoleFilter(value as RoleFilter)}
                options={roleOptions}
                className="max-w-full flex-wrap"
              />
            </div>
          ) : null}

          {benchVisible.length === 0 ? (
            <BenchEmptyState
              filtered={benchPlayers.length > 0}
              onBrowseMarket={() => onNavigate?.("Transfers")}
              onOpenAcademy={() => onNavigate?.("Youth")}
              onClearFilter={() => {
                setRoleFilter("all");
                setSearch("");
              }}
            />
          ) : (
            <ul className="@container overflow-hidden rounded-xl border border-line bg-card">
              {benchVisible.map((player) => {
                const model = models.get(player.id);
                if (!model) return null;
                return (
                  <BenchRow
                    key={player.id}
                    model={model}
                    loanListed={player.loan_listed === true}
                    onOpen={(id) => onSelectPlayer(id)}
                    onToggleTransfer={(id) => void handleToggleList("toggle_transfer_list", id)}
                    onToggleLoan={(id) => void handleToggleList("toggle_loan_list", id)}
                  />
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
