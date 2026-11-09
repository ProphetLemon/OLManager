import { useTranslation } from "react-i18next";
import type { JSX } from "react";
import { MatchSnapshot, EnginePlayerData } from "@/ui-v2/_legacy/components/match/types";
import { Badge } from "@/ui-v2/_legacy/components/ui";
import { ArrowUpDown, AlertTriangle, Wand2 } from "lucide-react";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { calcOvr } from "@/lib/players/lolPlayerStats";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";
import { MAX_IMPORTS_IN_STARTING_FIVE, countImports, isImportPlayer } from "@/lib/squad/imports";

export type LolRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

export const LOL_ROLE_ORDER: LolRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

export const ROLE_KEY_STATS: Record<LolRole, { label: string; key: string }[]> = {
  TOP: [
    { label: "MEC", key: "mechanics" },
    { label: "TF", key: "teamfighting" },
    { label: "DISC", key: "discipline" },
  ],
  JUNGLE: [
    { label: "MAC", key: "macro_play" },
    { label: "SHOT", key: "shotcalling" },
    { label: "DISC", key: "discipline" },
  ],
  MID: [
    { label: "MEC", key: "mechanics" },
    { label: "LAN", key: "laning" },
    { label: "MAC", key: "macro_play" },
  ],
  ADC: [
    { label: "LAN", key: "laning" },
    { label: "MEC", key: "mechanics" },
    { label: "MENT", key: "mental_resilience" },
  ],
  SUPPORT: [
    { label: "SHOT", key: "shotcalling" },
    { label: "MAC", key: "macro_play" },
    { label: "TF", key: "teamfighting" },
  ],
};

export function getPlayerLolRole(player: EnginePlayerData): LolRole {
  // Engine sends role as PascalCase (Top, Jungle, Mid, Adc, Support)
  const engineRole = String(player.role || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (engineRole === "TOP") return "TOP";
  if (engineRole === "JUNGLE") return "JUNGLE";
  if (engineRole === "MID") return "MID";
  if (engineRole === "ADC") return "ADC";
  if (engineRole === "SUPPORT") return "SUPPORT";

  return "JUNGLE";
}

/** Delegates to the shared OVR formula so every view uses the same calculation. */
export function getPositionOvr(p: EnginePlayerData): number {
  return calcOvr(
    p.mechanics,
    p.laning,
    p.teamfighting,
    p.macro_play,
    p.consistency,
    p.shotcalling,
    p.champion_pool,
    p.discipline,
    p.mental_resilience,
  );
}

export function condColor(c: number): string {
  if (c >= 75) return "text-club-text";
  if (c >= 50) return "text-amber-400";
  return "text-red-400";
}

export function statColor(v: number): string {
  if (v >= 75) return "text-club-text font-bold";
  if (v >= 60) return "text-foreground";
  return "text-muted-foreground";
}

export function getStatVal(p: EnginePlayerData, key: string): number {
  return (p as unknown as Record<string, number>)[key] ?? 0;
}

const LOL_ROLE_ICON_URLS: Record<string, string> = {
  TOP: ROLE_ICON_PATHS.TOP,
  JUNGLE: ROLE_ICON_PATHS.JUNGLE,
  MID: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  SUPPORT: ROLE_ICON_PATHS.SUPPORT,
};

interface PreMatchLineupProps {
  homeTeam: MatchSnapshot["home_team"];
  homeBench: EnginePlayerData[];
  awayTeam: MatchSnapshot["home_team"];
  awayBench: EnginePlayerData[];
  homeTeamColor: string;
  awayTeamColor: string;
  userSide: "Home" | "Away";
  selectedStarterId: string | null;
  isAutoSelecting: boolean;
  onSelectStarter: (id: string | null) => void;
  onSwap: (benchPlayerId: string) => void;
  onAutoSelect: () => void;
  /** Refusal shown above the lineup when a swap would exceed the import limit. */
  importNotice?: string | null;
}

/** Marks a player who is not a resident of the league's region. */
export function ImportBadge({ player }: { player: { is_import?: boolean } }): JSX.Element | null {
  const { t } = useTranslation();
  if (!isImportPlayer(player)) return null;
  return (
    <span
      data-testid="import-badge"
      title={t("squad.importTooltip", { max: MAX_IMPORTS_IN_STARTING_FIVE })}
      className="flex-shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px text-2xs font-heading font-bold uppercase tracking-wider text-amber-400"
    >
      {t("squad.importBadge")}
    </span>
  );
}

/** Renders a full lineup + bench column for one team. */
function TeamLineupColumn({
  team,
  bench,
  teamColor,
  isUserSide,
  selectedStarterId,
  onSelectStarter,
  onSwap,
}: {
  team: MatchSnapshot["home_team"];
  bench: EnginePlayerData[];
  teamColor: string;
  isUserSide: boolean;
  selectedStarterId: string | null;
  onSelectStarter: (id: string | null) => void;
  onSwap: (benchPlayerId: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const startersLabel = `${t("match.lineup")} 5`;

  return (
    <div className="bg-card rounded-xl border border-border p-4 transition-colors duration-300">
      {/* Header: Alineación 5 + Auto-select (user only) */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-heading font-bold uppercase tracking-widest text-muted-foreground">
          {startersLabel}
        </h3>
        <div className="flex items-center gap-2">
          {selectedStarterId && isUserSide && (
            <button
              onClick={() => onSelectStarter(null)}
              className="text-2xs text-muted-foreground hover:text-foreground font-heading uppercase tracking-wider"
            >
              {t("match.cancel")}
            </button>
          )}
          <Badge variant="primary" size="sm">
            {t("match.nPlayers", { count: team.players.length })}
          </Badge>

        </div>
      </div>

      {selectedStarterId && isUserSide && (
        <p className="text-2xs text-club-text font-heading uppercase tracking-wider mb-2">
          {t("match.swapPrompt")}
        </p>
      )}

      {/* Per-role lineup */}
      {LOL_ROLE_ORDER.map((role) => {
        const players = team.players.filter((p) => getPlayerLolRole(p) === role);
        const keyStats = ROLE_KEY_STATS[role] || [];
        return (
          <div key={role} className="mb-1">
            {players.length === 0 ? (
              <div className="flex items-center gap-2 py-1.5 px-2 text-caption text-muted-foreground">
                <img src={LOL_ROLE_ICON_URLS[role]} alt={role} className="w-5 h-5 object-contain flex-shrink-0" title={role} />
                {t("match.noBenchAvailable2")}
              </div>
            ) : (
              players.map((p) => {
                const ovr = getPositionOvr(p);
                const isSelected = isUserSide && selectedStarterId === p.id;
                const photoUrl = resolvePlayerPhoto(p.id, p.name, p.profile_image_url);
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (!isUserSide) return;
                      onSelectStarter(isSelected ? null : p.id);
                    }}
                    className={`flex items-center gap-2 py-1.5 px-2 rounded w-full text-left transition-all ${
                      !isUserSide
                        ? "cursor-default"
                        : isSelected
                          ? "bg-primary/10 ring-1 ring-primary/50"
                          : "hover:bg-muted"
                    }`}
                  >
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={p.name}
                        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-2xs font-heading font-bold flex-shrink-0"
                        style={{
                          backgroundColor: teamColor + "30",
                          color: teamColor,
                        }}
                      >
                        {p.name.substring(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm text-foreground font-medium flex-1 truncate">
                      {p.name}
                    </span>
                    <ImportBadge player={p} />
                    <img src={LOL_ROLE_ICON_URLS[role]} alt={role} className="w-5 h-5 object-contain" title={role} />
                    {isSelected && <ArrowUpDown className="w-3.5 h-3.5 text-club-text flex-shrink-0" />}
                    <div className="flex items-center gap-0">
                      <span
                        className={`text-2xs font-heading font-bold tabular-nums w-7 text-center ${
                          ovr >= 70 ? "text-club-text" : ovr >= 50 ? "text-muted-foreground" : "text-red-400"
                        }`}
                      >
                        {ovr}
                      </span>
                      {keyStats.map((s) => (
                        <span
                          key={s.label}
                          className={`text-2xs font-heading tabular-nums w-7 text-center ${statColor(
                            getStatVal(p, s.key),
                          )}`}
                        >
                          {getStatVal(p, s.key)}
                        </span>
                      ))}
                    </div>
                    <span className={`text-xs tabular-nums w-8 text-right ${condColor(p.condition)}`}>
                      {Math.round(p.condition)}%
                    </span>
                  </button>
                );
              })
            )}
          </div>
        );
      })}

      {/* Bench / Substitutes */}
      <div className="mt-6 pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-heading font-bold uppercase tracking-widest text-muted-foreground">
            {t("match.substitutes")}
          </h3>
          <Badge variant="neutral" size="sm">
            {t("match.nAvailable", { count: bench.length })}
          </Badge>
        </div>
        {bench.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">{t("match.noBenchAvailable2")}</p>
            ) : (
            <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-2 pb-1">
              <span className="w-7" />
              <span className="flex-1" />
              <span className="text-2xs font-heading uppercase tracking-widest text-muted-foreground/70 w-8 text-center">
                POS
              </span>
              <span className="text-2xs font-heading uppercase tracking-widest text-muted-foreground w-[84px] text-center">
                {t("match.keyStats")}
              </span>
              <span className="text-2xs font-heading uppercase tracking-widest text-muted-foreground w-8 text-right">
                FIT
              </span>
            </div>
            {bench.map((bp) => {
              const role = getPlayerLolRole(bp);
              const keyStats = ROLE_KEY_STATS[role] || [];
              const canSwap = isUserSide && selectedStarterId;
              const photoUrl = resolvePlayerPhoto(bp.id, bp.name, bp.profile_image_url);
              return (
                <button
                  key={bp.id}
                  onClick={() => {
                    if (!isUserSide) return;
                    if (selectedStarterId) onSwap(bp.id);
                  }}
                  className={`flex items-center gap-2 py-1.5 px-2 rounded w-full text-left transition-all ${
                    canSwap
                      ? "hover:bg-primary/10 hover:ring-1 hover:ring-primary/50 cursor-pointer"
                      : isUserSide
                        ? "hover:bg-muted"
                        : "cursor-default"
                  }`}
                >
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={bp.name}
                      className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-2xs font-heading font-bold text-muted-foreground flex-shrink-0">
                      {bp.name.substring(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm text-foreground font-medium flex-1 truncate">
                    {bp.name}
                  </span>
                  <ImportBadge player={bp} />
                  <img
                    src={LOL_ROLE_ICON_URLS[role]}
                    alt={role}
                    className="w-5 h-5 object-contain"
                    title={role}
                  />
                  <div className="flex items-center gap-0">
                    {keyStats.map((s) => (
                      <span
                        key={s.label}
                        className={`text-2xs font-heading tabular-nums w-7 text-center ${statColor(
                          getStatVal(bp, s.key),
                        )}`}
                      >
                        {getStatVal(bp, s.key)}
                      </span>
                    ))}
                  </div>
                  <span className={`text-xs tabular-nums w-8 text-right ${condColor(bp.condition)}`}>
                    {Math.round(bp.condition)}%
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PreMatchLineup({
  homeTeam,
  homeBench,
  awayTeam,
  awayBench,
  homeTeamColor,
  awayTeamColor,
  userSide,
  selectedStarterId,
  isAutoSelecting,
  onSelectStarter,
  onSwap,
  onAutoSelect,
  importNotice = null,
}: PreMatchLineupProps) {
  const { t } = useTranslation();
  const userStarters = userSide === "Home" ? homeTeam.players : awayTeam.players;
  const userImports = countImports(userStarters);
  const autoSelectLabel = t("match.autoSelectXI").replace(/XI/g, "5");

  return (
    <div className="flex flex-col gap-4">
      {/* Formation fit bar */}
      <div className="bg-card rounded-xl border border-border p-3 flex items-center justify-between transition-colors duration-300">
        <div className="flex items-center gap-4">
          <span           className="text-2xs font-heading uppercase tracking-widest text-muted-foreground">
            {t("match.formationFit")}
          </span>
          {LOL_ROLE_ORDER.map((role) => {
            const homeCount = homeTeam.players.filter((p) => getPlayerLolRole(p) === role).length;
            const awayCount = awayTeam.players.filter((p) => getPlayerLolRole(p) === role).length;
            const actual = userSide === "Home" ? homeCount : awayCount;
            const ok = actual === 1;
            return (
              <div key={role} className="flex items-center gap-1">
                <span className="text-2xs font-heading uppercase tracking-widest text-muted-foreground">
                  {role === "JUNGLE" ? "JG" : role}
                </span>
                <span
                  className={`text-sm font-heading font-bold tabular-nums ${ok ? "text-club-text" : "text-amber-400"}`}
                >
                  {actual}/1
                </span>
                {!ok && <AlertTriangle className="w-3 h-3 text-amber-400" />}
              </div>
            );
          })}
        </div>
        <span
          data-testid="import-count"
          className={`text-2xs font-heading uppercase tracking-widest ${
            userImports >= MAX_IMPORTS_IN_STARTING_FIVE ? "text-amber-400" : "text-muted-foreground"
          }`}
        >
          {t("squad.importsInLineup", { count: userImports, max: MAX_IMPORTS_IN_STARTING_FIVE })}
        </span>
        <button
          onClick={onAutoSelect}
          disabled={isAutoSelecting}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all ${
            isAutoSelecting
              ? "bg-muted text-muted-foreground cursor-wait"
              : "bg-primary/10 text-club-text hover:bg-primary/20"
          }`}
        >
          <Wand2 className="w-3.5 h-3.5" />
          {isAutoSelecting ? t("match.selecting") : autoSelectLabel}
        </button>
      </div>

      {importNotice && (
        <p
          role="alert"
          data-testid="import-notice"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-heading uppercase tracking-wider text-amber-400"
        >
          {importNotice}
        </p>
      )}

      {/* Two-column grid: HOME left, AWAY right */}
      <div className="grid grid-cols-2 gap-4">
        <TeamLineupColumn
          team={homeTeam}
          bench={homeBench}
          teamColor={homeTeamColor}
          isUserSide={userSide === "Home"}
          selectedStarterId={selectedStarterId}
          onSelectStarter={onSelectStarter}
          onSwap={onSwap}
        />
        <TeamLineupColumn
          team={awayTeam}
          bench={awayBench}
          teamColor={awayTeamColor}
          isUserSide={userSide === "Away"}
          selectedStarterId={selectedStarterId}
          onSelectStarter={onSelectStarter}
          onSwap={onSwap}
        />
      </div>
    </div>
  );
}


