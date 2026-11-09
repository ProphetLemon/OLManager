import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Eye, GraduationCap, ScanSearch, User } from "lucide-react";

import type { GameStateData } from "@/store/gameStore";
import { useTabUiField } from "@/store/tabUiStore";
import { sendScout } from "@/services/scoutingService";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";
import { calculateAvailableScouts, scoutMaxSlots } from "@/lib/scouting/helpers";
import { buildAlreadyScoutingIds, filterScoutablePlayers, paginateScoutablePlayers } from "@/lib/scouting/model";
import ScoutingAssignmentsListV2 from "./ScoutingAssignmentsListV2";
import ScoutingScoutDetailsCardV2 from "./ScoutingScoutDetailsCardV2";
import { Card, CardContent } from "@/ui-v2/components/ui/card";
import ScoutingPlayerSearchCardV2 from "./ScoutingPlayerSearchCardV2";

interface ScoutingTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (state: GameStateData) => void;
  onSelectPlayer?: (id: string) => void;
  onNavigate?: (tab: string) => void;
}

const SCOUTING_PAGE_SIZE = 20;

export function ScoutingTabV2({ gameState, onGameUpdate, onSelectPlayer, onNavigate }: ScoutingTabV2Props) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useTabUiField("scouting", "searchQuery");
  const [posFilter, setPosFilter] = useTabUiField("scouting", "posFilter");
  const [sending, setSending] = useState<string | null>(null);
  const [page, setPage] = useTabUiField("scouting", "page");

  const myTeamId = gameState.manager.team_id ?? "";
  const myTeam = gameState.teams.find((team) => team.id === myTeamId);
  const academyTeam = myTeam?.academy_team_id
    ? gameState.teams.find((team) => team.id === myTeam.academy_team_id)
    : gameState.teams.find((team) => team.team_kind === "Academy" && team.parent_team_id === myTeamId);
  const academyRosterCount = academyTeam
    ? gameState.players.filter((p) => p.team_id === academyTeam.id).length
    : 0;
  const scouts = gameState.staff.filter((s) => s.role === "Scout" && s.team_id === myTeamId);
  const assignments = gameState.scouting_assignments || [];
  const availableScouts = calculateAvailableScouts(scouts, assignments);
  const totalCapacity = scouts.reduce((s, scout) => s + scoutMaxSlots(scout.attributes.judging_ability), 0);

  const allScoutable = filterScoutablePlayers({
    players: gameState.players,
    teams: gameState.teams,
    myTeamId,
    posFilter,
    searchQuery,
  });
  const { totalPages, safePage, players: scoutablePlayers } = paginateScoutablePlayers(allScoutable, page, SCOUTING_PAGE_SIZE);
  const alreadyScoutingIds = buildAlreadyScoutingIds(assignments);

  const handleSendScout = async (playerId: string) => {
    if (availableScouts.length === 0) return;
    setSending(playerId);
    try {
      const updated = await sendScout(availableScouts[0].id, playerId);
      onGameUpdate(updated);
    } catch (err) {
      console.error("Failed to send scout:", err);
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6 scrollbar-v2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ScanSearch className="size-5 text-primary" />
        <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-foreground">
          {t("scouting.title")}
        </h2>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 xl:grid-cols-[1fr_1.4fr]">
        {/* Left column */}
        <div className="flex h-full flex-col gap-4">
          {scouts.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-card px-3 py-3 text-center">
                <Eye className="mx-auto mb-1 size-4 text-primary" />
                <p className="font-heading text-xl font-bold text-foreground tabular-nums">{scouts.length}</p>
                <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("scouting.scouts")}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-3 text-center">
                <Clock className="mx-auto mb-1 size-4 text-amber-400" />
                <p className="font-heading text-xl font-bold text-foreground tabular-nums">{assignments.length}/{totalCapacity}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all"
                    style={{ width: `${totalCapacity > 0 ? (assignments.length / totalCapacity) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-1 font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("scouting.activeAssignments")}</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-3 text-center">
                <User className="mx-auto mb-1 size-4 text-emerald-400" />
                <p className="font-heading text-xl font-bold text-foreground tabular-nums">{availableScouts.length}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all"
                    style={{ width: `${scouts.length > 0 ? (availableScouts.length / scouts.length) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-1 font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("scouting.freeSlots")}</p>
              </div>
            </div>
          )}

          {/* Academy card */}
          {academyTeam ? (
            <Card>
              <CardContent className="py-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      {(() => {
                        const academyLogo = academyTeam
                          ? (academyTeam.logo_url
                            ?? academyTeam.academy?.branding?.current_logo_url
                            ?? academyTeam.academy?.acquisition?.original_logo_url
                            ?? academyTeam.academy?.source_identity?.original_logo_url
                            ?? myTeam?.logo_url)
                          : null;
                        const logo = resolveTeamLogo(academyTeam?.name, academyLogo);
                        return logo ? (
                          <img src={logo} alt={academyTeam.name} className="size-7 object-contain" />
                        ) : (
                          <GraduationCap className="size-5 text-primary" />
                        );
                      })()}
                    </div>
                    <div>
                      <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">
                        {t("scouting.academyScoutingTag")}
                      </p>
                      <p className="mt-1 font-heading text-sm font-bold text-foreground">
                        {academyTeam.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("scouting.academyRosterCount", { count: academyRosterCount })}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 bg-muted/10 px-5 text-center">
              <div className="relative">
                <div className="flex size-14 items-center justify-center rounded-xl bg-muted/70">
                  <GraduationCap className="size-7 text-muted-foreground/30" />
                </div>
                <div className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-amber-500/20 ring-2 ring-background">
                  <span className="font-heading text-2xs font-bold text-amber-400">!</span>
                </div>
              </div>

              <div className="max-w-xs">
                <h3 className="font-heading text-sm font-bold text-foreground">
                  {t("scouting.academyPendingTitle", { defaultValue: "Sin academia" })}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("scouting.academyDescription", {
                    defaultValue: "Adquirí un equipo de academy para desarrollar jóvenes talentos y alimentar tu primer equipo con jugadores formados en casa.",
                  })}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onNavigate?.("Youth")}
                className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 font-heading text-xs font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20 active:translate-y-px"
              >
                <GraduationCap className="size-4" />
                {t("scouting.viewAcquisitionOptions")}
              </button>
            </div>
          )}

          <ScoutingAssignmentsListV2
            assignments={assignments}
            scouts={scouts}
            players={gameState.players}
            teams={gameState.teams}
            onSelectPlayer={onSelectPlayer}
          />

          <ScoutingScoutDetailsCardV2
            scouts={scouts}
            assignments={assignments}
            players={gameState.players}
          />
        </div>

        {/* Right column: player search */}
        <div className="flex h-full flex-col gap-4">
          {scouts.length > 0 ? (
            <ScoutingPlayerSearchCardV2
              players={scoutablePlayers}
              teams={gameState.teams}
              currentDate={gameState.clock.current_date}
              posFilter={posFilter}
              searchQuery={searchQuery}
              alreadyScoutingIds={alreadyScoutingIds}
              availableScoutCount={availableScouts.length}
              sendingPlayerId={sending}
              safePage={safePage}
              totalPages={totalPages}
              totalPlayers={allScoutable.length}
              pageSize={SCOUTING_PAGE_SIZE}
              onPositionFilterChange={(position) => { setPosFilter(position); setPage(0); }}
              onSearchQueryChange={(query) => { setSearchQuery(query); setPage(0); }}
              onSelectPlayer={onSelectPlayer}
              onSendScout={handleSendScout}
              onPreviousPage={() => setPage((p) => Math.max(0, p - 1))}
              onNextPage={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-lg border border-dashed border-border/50 bg-muted/10 px-6 py-12">
              <div className="relative">
                <div className="flex size-20 items-center justify-center rounded-2xl bg-muted/70">
                  <ScanSearch className="size-10 text-muted-foreground/30" />
                </div>
                <div className="absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full bg-amber-500/20 ring-2 ring-background">
                  <span className="font-heading text-xs font-bold text-amber-400 tabular-nums">0</span>
                </div>
              </div>

              <div className="max-w-sm text-center">
                <h3 className="font-heading text-base font-bold text-foreground">
                  {t("scouting.noScoutsTitle", { defaultValue: "Sin equipo de scouting" })}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {t("scouting.noScoutsDescription", {
                    defaultValue: "No tenés ojeadores en tu staff. Contratá al menos uno desde la página de Staff para empezar a evaluar jugadores y descubrir talentos ocultos.",
                  })}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onNavigate?.("Staff")}
                className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-5 py-2.5 font-heading text-sm font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20 hover:shadow-sm hover:shadow-primary/10 active:translate-y-px"
              >
                <User className="size-4" />
                {t("scouting.hireScoutCta", { defaultValue: "Contratar ojeador" })}
              </button>

              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    icon: Eye,
                    label: t("scouting.benefitEvaluate", { defaultValue: "Evaluar" }),
                    desc: t("scouting.benefitEvaluateDesc", { defaultValue: "Conocé el potencial real de cada jugador" }),
                  },
                  {
                    icon: Clock,
                    label: t("scouting.benefitCompare", { defaultValue: "Comparar" }),
                    desc: t("scouting.benefitCompareDesc", { defaultValue: "Compará stats y encontrá la mejor opción" }),
                  },
                  {
                    icon: GraduationCap,
                    label: t("scouting.benefitDiscover", { defaultValue: "Descubrir" }),
                    desc: t("scouting.benefitDiscoverDesc", { defaultValue: "Descubrí talentos ocultos en la academia y el mercado" }),
                  },
                ].map((benefit) => (
                  <div
                    key={benefit.label}
                    className="rounded-lg border border-border/40 bg-card/60 px-3 py-3 text-center transition-colors hover:border-border/80"
                  >
                    <benefit.icon className="mx-auto size-4 text-muted-foreground/50" />
                    <p className="mt-1.5 font-heading text-caption font-bold uppercase tracking-wider text-foreground/80">
                      {benefit.label}
                    </p>
                    <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground/60">
                      {benefit.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
