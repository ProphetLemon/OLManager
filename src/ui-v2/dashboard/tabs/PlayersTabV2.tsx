import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
} from "lucide-react";

import type { GameStateData, PlayerData, PlayerSelectionOptions } from "@/store/gameStore";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { getTeamName, calcAge, formatVal } from "@/lib/common/helpers";
import { getAllCountryNames } from "@/lib/common/countries";
import { getLolRoleForPlayer } from "@/lib/squad/helpers";
import { PlayerAvatar } from "@/ui-v2/_legacy/components/ui/PlayerAvatar";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";

import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { Separator } from "@/ui-v2/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui-v2/components/ui/table";
import { cn } from "@/ui-v2/lib/utils";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";

// ─── Types ──────────────────────────────────────────────────────

type LolRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";
type SortKey = "pos" | "name" | "age" | "nationality" | "team" | "value" | "ovr" | "status";
type StatusFilter = "all" | "transfer" | "loan";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

interface PlayersTabV2Props {
  gameState: GameStateData;
  onSelectPlayer: (id: string, options?: PlayerSelectionOptions) => void;
  onSelectTeam: (id: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────

const LOL_ROLES: LolRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

const LOL_ROLE_ORDER: Record<LolRole, number> = {
  TOP: 1,
  JUNGLE: 2,
  MID: 3,
  ADC: 4,
  SUPPORT: 5,
};

const ROLE_ICON_URLS: Record<string, string> = {
  TOP: ROLE_ICON_PATHS.TOP,
  JUNGLE: ROLE_ICON_PATHS.JUNGLE,
  MID: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  SUPPORT: ROLE_ICON_PATHS.SUPPORT,
};

/** Default sort direction per column — true = asc, false = desc. */
const DEFAULT_SORT_ASC: Partial<Record<SortKey, boolean>> = {
  pos: true,
  name: true,
  nationality: true,
  team: true,
};

const PAGE_SIZE = 30;

// ─── Helpers ────────────────────────────────────────────────────

function normalizeNick(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function dedupPlayers(players: PlayerData[]): PlayerData[] {
  const byNick = new Map<string, PlayerData>();
  for (const player of players) {
    const nick = normalizeNick(player.match_name || "");
    if (!nick) continue;
    const existing = byNick.get(nick);
    if (!existing) {
      byNick.set(nick, player);
      continue;
    }
    const playerContracted = player.team_id !== null;
    const existingContracted = existing.team_id !== null;
    if (playerContracted && !existingContracted) {
      byNick.set(nick, player);
    } else if (playerContracted === existingContracted) {
      // Both contracted or both free — prefer higher OVR
      if (calculateLolOvr(player) > calculateLolOvr(existing)) {
        byNick.set(nick, player);
      }
    }
  }
  return [...byNick.values()];
}

// ─── Component ──────────────────────────────────────────────────

export function PlayersTabV2({
  gameState,
  onSelectPlayer,
  onSelectTeam,
}: PlayersTabV2Props) {
  const { t } = useTranslation();
  // ── Local state ──────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<Set<LolRole>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [competitionFilter, setCompetitionFilter] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "ovr", dir: "desc" });
  const [page, setPage] = useState(1);

  // ── Debounced search ─────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Derived data ─────────────────────────────────────────────
  const deduped = useMemo(() => dedupPlayers(gameState.players), [gameState.players]);

  const competitionTeamIds = useMemo(() => {
    if (!competitionFilter) return null;
    return new Set(
      gameState.teams
        .filter((t) => t.competition_id === competitionFilter)
        .map((t) => t.id),
    );
  }, [gameState.teams, competitionFilter]);

  const teamsForDropdown = useMemo(() => {
    if (!competitionFilter) return gameState.teams;
    return gameState.teams.filter((t) => t.competition_id === competitionFilter);
  }, [gameState.teams, competitionFilter]);

  const leagues = useMemo(
    () =>
      gameState.leagues.map((l) => ({
        id: l.competition_id ?? l.id,
        name: l.name,
      })),
    [gameState.leagues],
  );

  // Reset team filter when competition changes (the selected team may not exist in the new comp)
  useEffect(() => {
    if (competitionFilter) setTeamFilter(null);
  }, [competitionFilter]);

  // ── Filter pipeline ──────────────────────────────────────────
  const filtered = useMemo(() => {
    return deduped.filter((p) => {
      // Search (min 2 chars)
      if (debouncedSearch.length >= 2) {
        const q = debouncedSearch.toLowerCase();
        const nameMatch =
          p.full_name.toLowerCase().includes(q) ||
          p.match_name.toLowerCase().includes(q);
        const nationalityMatch =
          p.nationality.toLowerCase().includes(q) ||
          [...getAllCountryNames(p.nationality)].some((name) => name.includes(q));
        if (!nameMatch && !nationalityMatch) return false;
      }

      // Role (empty set = show all)
      if (selectedRoles.size > 0) {
        const playerRole = getLolRoleForPlayer(p);
        if (!selectedRoles.has(playerRole)) return false;
      }

      // Status
      if (statusFilter === "transfer" && !p.transfer_listed) return false;
      if (statusFilter === "loan" && !p.loan_listed) return false;

      // Competition
      if (competitionTeamIds && (!p.team_id || !competitionTeamIds.has(p.team_id)))
        return false;

      // Team
      if (teamFilter && p.team_id !== teamFilter) return false;

      return true;
    });
  }, [deduped, debouncedSearch, selectedRoles, statusFilter, competitionTeamIds, teamFilter]);

  // ── Sort pipeline ────────────────────────────────────────────
  const sorted = useMemo(() => {
    const copy = [...filtered];
    const { key, dir } = sort;
    copy.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "pos":
          cmp =
            LOL_ROLE_ORDER[getLolRoleForPlayer(a)] -
            LOL_ROLE_ORDER[getLolRoleForPlayer(b)];
          break;
        case "name":
          cmp = a.match_name.localeCompare(b.match_name);
          break;
        case "age":
          cmp =
            calcAge(a.date_of_birth, gameState.clock.current_date) -
            calcAge(b.date_of_birth, gameState.clock.current_date);
          break;
        case "nationality":
          cmp = (a.nationality ?? "").localeCompare(b.nationality ?? "");
          break;
        case "team":
          cmp = getTeamName(gameState.teams, a.team_id).localeCompare(
            getTeamName(gameState.teams, b.team_id),
          );
          break;
        case "value":
          cmp = (a.market_value || 0) - (b.market_value || 0);
          break;
        case "ovr":
          cmp = calculateLolOvr(a) - calculateLolOvr(b);
          break;
        case "status": {
          const statusVal = (p: PlayerData) => {
            if (p.loan_listed) return 3;
            if (p.transfer_listed) return 2;
            return 0;
          };
          cmp = statusVal(b) - statusVal(a); // desc: loan > transfer > none
          break;
        }
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sort, gameState.clock.current_date, gameState.teams]);

  // ── Pagination ───────────────────────────────────────────────
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  // Reset to page 1 when filters or sort change
  const filterKey = `${debouncedSearch}|${[...selectedRoles].sort().join(",")}|${statusFilter}|${competitionFilter}|${teamFilter}|${sort.key}|${sort.dir}`;
  useEffect(() => setPage(1), [filterKey]);

  const paginated = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page],
  );

  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, sorted.length);

  // ── Handlers ─────────────────────────────────────────────────
  const handleSort = useCallback(
    (key: SortKey) => {
      setSort((prev) => {
        if (prev.key === key) {
          return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
        }
        return { key, dir: DEFAULT_SORT_ASC[key] ? "asc" : "desc" };
      });
    },
    [],
  );

  const toggleRole = useCallback((role: LolRole) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setSelectedRoles(new Set());
    setStatusFilter("all");
    setCompetitionFilter(null);
    setTeamFilter(null);
  }, []);

  // ── Render: empty state ──────────────────────────────────────
  if (gameState.players.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <p className="font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {t("players.notFound")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4 p-6 overflow-hidden">
      <Card className="flex h-full flex-col overflow-hidden">
        {/* ── Header ──────────────────────────────────────────── */}
        <CardHeader className="shrink-0 space-y-4">
          <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
            {t("players.title")}
          </CardTitle>

          {/* Search + filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search input */}
            <div className="relative min-w-[200px] max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("players.searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-muted/30 py-1.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* Role chips */}
            <div className="flex gap-1">
              {LOL_ROLES.map((role) => {
                const active = selectedRoles.has(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={cn(
                      "flex items-center gap-1 rounded-md border px-2 py-1 font-heading text-xs font-bold uppercase tracking-wide transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                    )}
                    title={role}
                  >
                    <img
                      src={ROLE_ICON_URLS[role]}
                      alt={role}
                      className="size-4 object-contain opacity-80"
                    />
                    {role}
                  </button>
                );
              })}
            </div>

            {/* Status pills */}
            <div className="flex gap-1">
              {(
                [
                  ["all", "players.filterAll"],
                  ["transfer", "players.filterTransfer"],
                  ["loan", "players.filterLoan"],
                ] as [StatusFilter, string][]
              ).map(([value, labelKey]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 font-heading text-xs font-bold uppercase tracking-wide transition-colors",
                    statusFilter === value && value === "all"
                      ? "border-primary bg-primary/10 text-primary"
                      : statusFilter === value && value === "transfer"
                        ? "border-orange-500/50 bg-orange-500/10 text-orange-400"
                        : statusFilter === value && value === "loan"
                          ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>

            {/* Competition select */}
            <select
              value={competitionFilter ?? ""}
              onChange={(e) => setCompetitionFilter(e.target.value || null)}
              className={cn(
                "min-w-32 rounded-md border border-border bg-card px-2.5 py-1 font-heading text-xs font-bold uppercase tracking-wide text-foreground transition-colors",
                "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
              )}
            >
              <option value="">{t("players.allCompetitions")}</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>

            {/* Team select */}
            <select
              value={teamFilter ?? ""}
              onChange={(e) => setTeamFilter(e.target.value || null)}
              className={cn(
                "min-32 rounded-md border border-border bg-card px-2.5 py-1 font-heading text-xs font-bold uppercase tracking-wide text-foreground transition-colors",
                "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
              )}
            >
              <option value="">{t("players.allTeams")}</option>
              {teamsForDropdown.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>

        <Separator className="mb-0" />

        {/* ── Table ───────────────────────────────────────────── */}
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 scrollbar-v2">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">
                {t("players.notFound")}
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md border border-border px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary/10"
              >
                {t("players.clearFilters")}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12" />
                    {/* Photo */}
                    <SortHead
                      label={t("players.colPos")}
                      sortKey="pos"
                      current={sort.key}
                      dir={sort.dir}
                      onSort={handleSort}
                    />
                    <SortHead
                      label={t("players.colPlayer")}
                      sortKey="name"
                      current={sort.key}
                      dir={sort.dir}
                      onSort={handleSort}
                    />
                    <SortHead
                      label={t("players.colAge")}
                      sortKey="age"
                      current={sort.key}
                      dir={sort.dir}
                      onSort={handleSort}
                    />
                    <SortHead
                      label={t("players.colNation")}
                      sortKey="nationality"
                      current={sort.key}
                      dir={sort.dir}
                      onSort={handleSort}
                    />
                    <SortHead
                      label={t("players.colTeam")}
                      sortKey="team"
                      current={sort.key}
                      dir={sort.dir}
                      onSort={handleSort}
                    />
                    <SortHead
                      label={t("players.colValue")}
                      sortKey="value"
                      current={sort.key}
                      dir={sort.dir}
                      onSort={handleSort}
                    />
                    <SortHead
                      label={t("players.colOvr")}
                      sortKey="ovr"
                      current={sort.key}
                      dir={sort.dir}
                      onSort={handleSort}
                    />
                    <SortHead
                      label={t("players.colStatus")}
                      sortKey="status"
                      current={sort.key}
                      dir={sort.dir}
                      onSort={handleSort}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((player) => {
                    const role = getLolRoleForPlayer(player);
                    const ovr = calculateLolOvr(player);
                    const age = calcAge(player.date_of_birth, gameState.clock.current_date);
                    const photo = resolvePlayerPhoto(
                      player.id,
                      player.match_name,
                      player.profile_image_url,
                    );
                    const teamName = player.team_id
                      ? getTeamName(gameState.teams, player.team_id)
                      : null;
                    const playerTeam = player.team_id
                      ? gameState.teams.find((t) => t.id === player.team_id)
                      : null;
                    const teamLogo = playerTeam
                      ? resolveTeamLogo(playerTeam.short_name ?? playerTeam.name, playerTeam.logo_url)
                      : null;
                    return (
                      <TableRow
                        key={player.id}
                        className="cursor-pointer"
                        onClick={() => onSelectPlayer(player.id)}
                      >
                        {/* Photo */}
                        <TableCell>
                          <PlayerAvatar
                            src={photo}
                            alt={player.match_name}
                            className="size-8"
                          />
                        </TableCell>

                        {/* Position */}
                        <TableCell>
                          <div className="flex size-7 items-center justify-center rounded-md border border-border bg-muted/50">
                            <img
                              src={ROLE_ICON_URLS[role]}
                              alt={role}
                              className="size-4 object-contain opacity-80"
                            />
                          </div>
                        </TableCell>

                        {/* Name + full_name */}
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-heading text-base font-bold text-foreground leading-tight">
                              {player.match_name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground leading-tight">
                              {player.full_name}
                            </p>
                          </div>
                        </TableCell>

                        {/* Age */}
                        <TableCell className="tabular-nums text-foreground">
                          {age}
                        </TableCell>

                        {/* Nationality */}
                        <TableCell>
                          <span className="flex items-center gap-1.5">
                            <CountryFlag code={player.nationality} className="text-lg" />
                            <span className="text-xs text-muted-foreground">
                              {player.nationality}
                            </span>
                          </span>
                        </TableCell>

                        {/* Team */}
                        <TableCell>
                          {player.team_id ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectTeam(player.team_id!);
                              }}
                              className="flex items-center gap-1.5 text-left font-medium text-foreground transition-colors hover:text-primary"
                            >
                              {teamLogo && (
                                <img
                                  src={teamLogo}
                                  alt=""
                                  className="size-5 rounded-sm object-contain"
                                />
                              )}
                              <span className="truncate">{teamName}</span>
                            </button>
                          ) : (
                            <span className="italic text-muted-foreground">
                              {t("players.noTeam")}
                            </span>
                          )}
                        </TableCell>

                        {/* Value */}
                        <TableCell className="tabular-nums text-foreground">
                          {formatVal(player.market_value)}
                        </TableCell>

                        {/* OVR */}
                        <TableCell>
                          <span
                            className={cn(
                              "font-heading text-base font-bold tabular-nums",
                              ovr >= 75
                                ? "text-primary"
                                : ovr >= 55
                                  ? "text-amber-400"
                                  : "text-muted-foreground",
                            )}
                          >
                            {ovr}
                          </span>
                        </TableCell>

                        {/* Status badge */}
                        <TableCell>
                          <div className="flex gap-1">
                            {player.transfer_listed && (
                              <Badge
                                variant="outline"
                                className="border-orange-500/30 bg-orange-500/10 text-orange-400"
                              >
                                {t("players.transferListed")}
                              </Badge>
                            )}
                            {player.loan_listed && (
                              <Badge
                                variant="outline"
                                className="border-blue-500/30 bg-blue-500/10 text-blue-400"
                              >
                                {t("players.loanListed")}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {/* ── Pagination ──────────────────────────────────────── */}
        {totalPages > 1 && (
          <>
            <Separator />
            <div className="flex items-center justify-between px-4 py-3">
              <p className="font-heading text-xs font-bold tracking-wider text-muted-foreground tabular-nums">
                {t("players.showingRange", { from, to, total: sorted.length })}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronsLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="px-3 py-1 font-heading text-xs font-bold text-foreground tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronRight className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronsRight className="size-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ─── Sort Header Sub-component ──────────────────────────────────

function SortHead({
  label,
  sortKey,
  current,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <TableHead
      onClick={() => onSort(sortKey)}
      className={cn(
        "cursor-pointer select-none font-heading text-xs uppercase tracking-widest transition-colors hover:text-foreground",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={cn("text-xs", active ? "text-primary" : "text-muted-foreground/40")}>
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </span>
    </TableHead>
  );
}
