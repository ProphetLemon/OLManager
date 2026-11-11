import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Eye,
  GraduationCap,
  Loader2,
  Search,
  Stethoscope,
  UserCog,
  UserMinus,
  UserPlus,
  Star,
  Frown,
  Users,
} from "lucide-react";

import type { GameStateData, StaffData } from "@/store/gameStore";
import { hireStaff, releaseStaff } from "@/services/staffService";
import {
  formatStaffEffectPercent,
  getLolStaffEffectsForTeam,
} from "@/lib/teams/lolStaffEffects";
import { resolveStaffPhoto } from "@/lib/players/playerPhotos";
import { staffDisplayName } from "@/lib/staff/staffName";
import { staffAge } from "@/lib/staff/staffAge";
import { staffErrorKey } from "@/lib/staff/staffErrors";
import { ATTR_LABEL_KEYS, bestAttr, ovrRating, getStaffImpactRows } from "@/lib/staff/staffStats";
import { getTeamName } from "@/lib/common/helpers";
import { countryName } from "@/lib/common/countries";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";
import { Card, CardContent } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { Button } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { activeCurrencySymbol } from "@/lib/formatting/valueFormatting";

interface StaffTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (state: GameStateData) => void;
  mode?: "club" | "world";
  onSelectStaff?: (id: string) => void;
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  AssistantManager: <Briefcase className="size-4" />,
  Coach: <GraduationCap className="size-4" />,
  Scout: <Eye className="size-4" />,
  Physio: <Stethoscope className="size-4" />,
  Owner: <Star className="size-4" />,
};

type StaffAttrKey = keyof typeof ATTR_LABEL_KEYS;

export function StaffTabV2({ gameState, onGameUpdate, mode = "club", onSelectStaff }: StaffTabV2Props) {
  const { t, i18n } = useTranslation();
  const isWorldMode = mode === "world";
  const userTeamId = gameState.manager.team_id;
  const [view, setView] = useState<"mystaff" | "available">("mystaff");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [competitionFilter, setCompetitionFilter] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [releaseTarget, setReleaseTarget] = useState<StaffData | null>(null);
  const releaseOpenerRef = useRef<HTMLElement | null>(null);
  const cancelReleaseRef = useRef<HTMLButtonElement | null>(null);
  const PAGE_SIZE = 12;

  const myStaff = gameState.staff.filter((s) => s.team_id === userTeamId);
  // Club owners belong to their club and are never offered in the market.
  const availableStaff = gameState.staff.filter((s) => !s.team_id && s.role !== "Owner");
  const displayStaff = isWorldMode
    ? gameState.staff
    : view === "mystaff"
      ? myStaff
      : availableStaff;

  const competitionTeamIds = useMemo(() => {
    if (!competitionFilter) return null;
    return new Set(
      gameState.teams.filter((t) => t.competition_id === competitionFilter).map((t) => t.id),
    );
  }, [gameState.teams, competitionFilter]);

  const leagueOptions = useMemo(
    () => gameState.leagues.map((l) => ({ id: l.competition_id ?? l.id, name: l.name })),
    [gameState.leagues],
  );

  const filtered = displayStaff.filter((s) => {
    if (roleFilter && s.role !== roleFilter) return false;
    if (competitionTeamIds && (!s.team_id || !competitionTeamIds.has(s.team_id))) return false;
    if (search.length >= 2) {
      const q = search.toLowerCase();
      const haystack = `${staffDisplayName(s)} ${s.first_name} ${s.last_name}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageData = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => setPage(0), [view, roleFilter, competitionFilter, search]);

  const roles = useMemo(
    () => Array.from(new Set(gameState.staff.map((s) => s.role))).sort(),
    [gameState.staff],
  );

  const teamEffects = getLolStaffEffectsForTeam(gameState, userTeamId);

  const handleHire = async (staffId: string) => {
    setActionLoading(staffId);
    setActionError(null);
    try {
      const updated = await hireStaff(staffId);
      onGameUpdate(updated);
    } catch (err) {
      console.error("Failed to hire staff:", err);
      setActionError(t(staffErrorKey(err)));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRelease = async (staffId: string) => {
    setActionLoading(staffId);
    setActionError(null);
    try {
      const updated = await releaseStaff(staffId);
      onGameUpdate(updated);
    } catch (err) {
      console.error("Failed to release staff:", err);
      setActionError(t(staffErrorKey(err)));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {isWorldMode ? (
          <div className="rounded-lg border border-border bg-card px-4 py-1.5">
            <p className="font-heading text-xs font-bold uppercase tracking-wider text-foreground">
              {t("dashboard.worldStaff", { defaultValue: "Staffs" })}
            </p>
            <p className="text-caption text-muted-foreground">
              {filtered.length} / {gameState.staff.length}
            </p>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView("mystaff")}
              className={`rounded-lg border px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider transition-all ${
                view === "mystaff"
                  ? "border-primary bg-primary/10 text-club-text"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              <UserCog className="mr-1 inline size-3.5" />
              {t("staff.myStaff", { count: myStaff.length })}
            </button>
            <button
              type="button"
              onClick={() => setView("available")}
              className={`rounded-lg border px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider transition-all ${
                view === "available"
                  ? "border-primary bg-primary/10 text-club-text"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              <UserPlus className="mr-1 inline size-3.5" />
              {t("staff.available", { count: availableStaff.length })}
            </button>
          </div>
        )}

        <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 min-w-40">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("staff.searchStaff")}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground"
          />
        </div>

        <select
          value={competitionFilter ?? ""}
          onChange={(e) => setCompetitionFilter(e.target.value || null)}
          className="h-8 rounded-md border border-border bg-card pl-2 pr-8 text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground"
        >
          <option value="">{t("common.all")}</option>
          {leagueOptions.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setRoleFilter(null)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              !roleFilter
                ? "border-primary bg-primary/10 text-club-text"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {t("common.all")}
          </button>
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(roleFilter === r ? null : r)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                roleFilter === r
                  ? "border-primary bg-primary/10 text-club-text"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {ROLE_ICONS[r]} {t(`staff.roles.${r}`, { defaultValue: r })}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-2 text-sm text-negative">
          {actionError}
        </div>
      )}

      {/* Team impact banner */}
      {view === "mystaff" && myStaff.some((s) => s.role !== "Owner") && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
          <span className="font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
            {t("staff.lolImpactTeamTitle")}
          </span>
          {[
            { key: "development", labelKey: "staff.lolImpact.development" },
            { key: "tactics", labelKey: "staff.lolImpact.tactics" },
            { key: "analysis", labelKey: "staff.lolImpact.analysis" },
            { key: "execution", labelKey: "staff.lolImpact.execution" },
            { key: "recovery", labelKey: "staff.lolImpact.recovery" },
          ].map((row) => (
            <span
              key={row.key}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-heading text-2xs uppercase tracking-wider text-club-text"
            >
              <span>{t(row.labelKey)}</span>
              <span className="font-bold tabular-nums">
                {formatStaffEffectPercent((teamEffects as unknown as Record<string, number>)[row.key])}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Staff grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            {roleFilter || search.length >= 2 || competitionFilter ? (
              <>
                <Frown className="mx-auto mb-2 size-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {t("staff.noStaffMatch")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Try adjusting filters or search
                </p>
              </>
            ) : (
              <>
                {view === "mystaff" ? (
                  <>
                    <UserCog className="mx-auto mb-2 size-10 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      {t("staff.noStaffMatch")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Hire staff from the available tab
                    </p>
                  </>
                ) : (
                  <>
                    <Users className="mx-auto mb-2 size-10 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      {t("staff.noAvailableStaff")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      All staff are currently employed
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
          {pageData.map((staff) => {
            const roleIcon = ROLE_ICONS[staff.role] || <GraduationCap className="size-4" />;
            const age = staffAge(staff, gameState.clock.current_date);
            const isOwner = staff.role === "Owner";
            const ovr = ovrRating(staff);
            const best = bestAttr(staff);
            const impactRows = getStaffImpactRows(staff);
            const photo = resolveStaffPhoto(staff.profile_image_url);
            const attrLabel = (key: StaffAttrKey) => t(ATTR_LABEL_KEYS[key]);

            return (
              <Card
                key={staff.id}
                className="h-full cursor-pointer transition-all hover:ring-1 hover:ring-primary/30"
                onClick={() => onSelectStaff?.(staff.id)}
              >
                <CardContent className="flex gap-4">
                  {/* Avatar */}
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
                    {photo ? (
                      <img
                        src={photo}
                        alt={staffDisplayName(staff)}
                        className="size-full object-cover"
                        onError={(e) => { e.currentTarget.src = "/default/defaultstaff.webp"; }}
                      />
                    ) : (
                      roleIcon
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Name + OVR */}
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-heading text-sm font-bold uppercase tracking-wide text-foreground">
                        {staffDisplayName(staff)}
                      </h3>
                      <Badge
                        variant={ovr >= 65 ? "default" : ovr >= 45 ? "secondary" : "outline"}
                        className="text-2xs"
                      >
                        {ovr} OVR
                      </Badge>
                    </div>

                    {/* Role + Age + Nationality + Team */}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{t(`staff.roles.${staff.role}`, { defaultValue: staff.role })}</span>
                      {age != null && (
                        <>
                          <span className="text-border">·</span>
                          <span>{t("common.age")} {age}</span>
                        </>
                      )}
                      {staff.nationality && (
                        <>
                          <span className="text-border">·</span>
                          <span className="inline-flex items-center gap-1">
                            <CountryFlag code={staff.nationality} locale={i18n.language} className="text-xs leading-none" />
                            <span>{countryName(staff.nationality, i18n.language)}</span>
                          </span>
                        </>
                      )}
                      {(isWorldMode || view === "available") && staff.team_id && (
                        <>
                          <span className="text-border">·</span>
                          <span className="text-muted-foreground/70">
                            @ {getTeamName(gameState.teams, staff.team_id)}
                          </span>
                        </>
                      )}
                    </p>

                    {/* Specialization + Wage */}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {isOwner && (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-heading text-2xs uppercase tracking-wider text-foreground">
                          <Star className="size-3" /> {t("staff.clubOwner")}
                        </span>
                      )}
                      {staff.specialization && (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-heading text-2xs uppercase tracking-wider text-muted-foreground">
                          <Star className="size-3" /> {t(`staff.specializations.${staff.specialization}`)}
                        </span>
                      )}
                      {staff.wage > 0 && (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-heading text-2xs uppercase tracking-wider text-muted-foreground">
                          {activeCurrencySymbol()}{staff.wage.toLocaleString()}/año
                        </span>
                      )}
                    </div>

                    {/* Attributes */}
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                      <AttrBar label={attrLabel("coaching")} value={staff.attributes.coaching} />
                      <AttrBar label={attrLabel("judgingAbility")} value={staff.attributes.judging_ability} />
                      <AttrBar label={attrLabel("judgingPotential")} value={staff.attributes.judging_potential} />
                      <AttrBar label={attrLabel("physiotherapy")} value={staff.attributes.physiotherapy} />
                    </div>

                    {/* Separator + Impact */}
                    {impactRows.length > 0 && (
                      <>
                        <div className="my-2.5 border-t border-border/40" />
                        <div className="flex flex-wrap items-center gap-1.5">
                          {impactRows.map((row) => (
                            <span
                              key={row.labelKey}
                              className="inline-flex items-center gap-1 rounded bg-primary/5 px-1.5 py-0.5 font-heading text-2xs uppercase tracking-wider text-muted-foreground"
                            >
                              <span>{t(row.labelKey)}</span>
                              <span className="font-bold text-club-text tabular-nums">
                                {formatStaffEffectPercent(row.value)}
                              </span>
                            </span>
                          ))}
                        </div>
                      </>
                    )}

                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("staff.best")}: <span className="font-medium text-foreground">{attrLabel(best.key as StaffAttrKey)} ({best.value})</span>
                    </p>
                  </div>

                  {/* Action */}
                  <div className="flex shrink-0 flex-col items-center justify-start gap-2">
                    {!isWorldMode && view === "mystaff" && !isOwner && (
                      <button
                        type="button"
                        disabled={actionLoading === staff.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          releaseOpenerRef.current = e.currentTarget;
                          setReleaseTarget(staff);
                        }}
                        className="flex size-8 min-h-[var(--target-min)] min-w-[var(--target-min)] items-center justify-center rounded-lg bg-negative/10 text-negative transition-colors hover:bg-negative/20 disabled:pointer-events-none disabled:opacity-50"
                        aria-label={t("staff.releaseStaffNamed", { name: staffDisplayName(staff) })}
                        title={t("staff.releaseStaff")}
                      >
                        {actionLoading === staff.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <UserMinus className="size-4" aria-hidden="true" />
                        )}
                      </button>
                    )}
                    {!isWorldMode && view === "available" && (
                      <button
                        type="button"
                        disabled={actionLoading === staff.id}
                        onClick={(e) => { e.stopPropagation(); handleHire(staff.id); }}
                        className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-club-text transition-colors hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-50"
                        title={t("staff.hireStaff")}
                      >
                        {actionLoading === staff.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <UserPlus className="size-4" />
                        )}
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-3 pb-2">
          <button
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
            className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="font-heading text-xs font-bold tabular-nums text-muted-foreground">
            {safePage + 1} / {totalPages}
          </span>
          <button
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage(safePage + 1)}
            className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
      <Dialog
        open={releaseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReleaseTarget(null);
        }}
      >
        <DialogContent
          className="max-w-sm"
          initialFocus={cancelReleaseRef}
          finalFocus={() => (releaseOpenerRef.current?.isConnected ? releaseOpenerRef.current : true)}
        >
          {releaseTarget ? (
            <>
              <DialogTitle className="text-lg text-foreground">
                {t("staff.releaseConfirmTitle", { name: staffDisplayName(releaseTarget) })}
              </DialogTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("staff.releaseConfirmMessage", {
                  name: staffDisplayName(releaseTarget),
                  role: t(`staff.roles.${releaseTarget.role}`, { defaultValue: releaseTarget.role }),
                })}
              </p>
              <DialogFooter className="mt-6 flex-col">
                <Button
                  ref={cancelReleaseRef}
                  type="button"
                  variant="outline"
                  size="touch"
                  onClick={() => setReleaseTarget(null)}
                  className="w-full font-heading font-bold uppercase tracking-wider"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="touch"
                  onClick={() => {
                    const id = releaseTarget.id;
                    setReleaseTarget(null);
                    void handleRelease(id);
                  }}
                  className="w-full font-heading font-bold uppercase tracking-wider"
                >
                  {t("staff.releaseConfirmAction")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttrBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = value >= 70 ? "bg-positive" : value >= 50 ? "bg-warning" : "bg-muted-foreground/40";
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-heading font-bold tabular-nums ${value >= 70 ? "text-positive" : value >= 50 ? "text-warning" : "text-muted-foreground"}`}>
          {value}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
