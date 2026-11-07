import { useMemo, useState } from "react";
import { GameStateData, StaffData } from "@/store/gameStore";
import { Card, CardBody, Badge, CountryFlag, ProgressBar, Select } from "@/ui-v2/_legacy/components/ui";
import {
  UserCog,
  Search,
  UserPlus,
  UserMinus,
  Briefcase,
  Eye,
  Stethoscope,
  GraduationCap,
  Star,
} from "lucide-react";
import {
  getTeamName,
  calcAge,
} from "@/lib/common/helpers";
import { countryName } from "@/lib/common/countries";
import { useTranslation } from "react-i18next";
import { hireStaff, releaseStaff } from "@/services/staffService";
import {
  formatStaffEffectPercent,
  getLolStaffEffectsForTeam,
} from "@/lib/teams/lolStaffEffects";
import { resolveStaffPhoto } from "@/lib/players/playerPhotos";
import { staffDisplayName } from "@/lib/staff/staffName";
import { activeCurrencySymbol } from "@/lib/formatting/valueFormatting";

interface StaffTabProps {
  gameState: GameStateData;
  onGameUpdate?: (state: GameStateData) => void;
  mode?: "club" | "world";
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  AssistantManager: <Briefcase className="w-4 h-4" />,
  Coach: <GraduationCap className="w-4 h-4" />,
  Scout: <Eye className="w-4 h-4" />,
  Physio: <Stethoscope className="w-4 h-4" />,
  Owner: <Star className="w-4 h-4" />,
};
const ROLE_COLORS: Record<string, string> = {
  AssistantManager: "text-blue-500",
  Coach: "text-primary-500",
  Scout: "text-accent-500",
  Physio: "text-red-400",
  Owner: "text-yellow-500",
};

const ATTR_LABEL_KEYS = {
  coaching: "staff.lolAttrs.coaching",
  judgingAbility: "staff.lolAttrs.judgingAbility",
  judgingPotential: "staff.lolAttrs.judgingPotential",
  physiotherapy: "staff.lolAttrs.physiotherapy",
} as const;

const TEAM_IMPACT_ROWS = [
  { key: "development", labelKey: "staff.lolImpact.development" },
  { key: "tactics", labelKey: "staff.lolImpact.tactics" },
  { key: "analysis", labelKey: "staff.lolImpact.analysis" },
  { key: "execution", labelKey: "staff.lolImpact.execution" },
  { key: "recovery", labelKey: "staff.lolImpact.recovery" },
] as const;

type StaffAttrKey = keyof typeof ATTR_LABEL_KEYS;
type ImpactRow = { labelKey: string; value: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function qualityMult(value: number, min: number, max: number): number {
  return clamp(min + (clamp(value, 0, 100) / 100) * (max - min), min, max);
}

function bestAttr(s: StaffData): { key: string; value: number } {
  const attrs = [
    { key: "coaching", value: s.attributes.coaching },
    { key: "judgingAbility", value: s.attributes.judging_ability },
    { key: "judgingPotential", value: s.attributes.judging_potential },
    { key: "physiotherapy", value: s.attributes.physiotherapy },
  ];
  return attrs.reduce((a, b) => (b.value > a.value ? b : a));
}

function ovrRating(s: StaffData): number {
  const { coaching, judging_ability, judging_potential, physiotherapy } = s.attributes;
  const weights: Record<string, [number, number, number, number]> = {
    Coach: [0.7, 0.15, 0.1, 0.05],
    AssistantManager: [0.35, 0.25, 0.25, 0.15],
    Scout: [0.1, 0.45, 0.4, 0.05],
    Physio: [0.15, 0.05, 0.05, 0.75],
  };
  const [coachW, abilityW, potentialW, physioW] = weights[s.role] ?? [0.25, 0.25, 0.25, 0.25];
  return Math.round(
    coaching * coachW +
      judging_ability * abilityW +
      judging_potential * potentialW +
      physiotherapy * physioW,
  );
}

function getStaffImpactRows(s: StaffData): ImpactRow[] {
  const coaching = qualityMult(s.attributes.coaching, 0.88, 1.22);
  const development = qualityMult(s.attributes.coaching, 0.92, 1.18);
  const tactics = qualityMult(s.attributes.coaching, 0.94, 1.14);
  const analysis = qualityMult(s.attributes.judging_ability, 0.94, 1.14);
  const potential = qualityMult(s.attributes.judging_potential, 0.98, 1.16);
  const recovery = qualityMult(s.attributes.physiotherapy, 1, 1.2);
  const morale = qualityMult(
    s.role === "Physio" ? s.attributes.physiotherapy : s.attributes.coaching,
    0.96,
    1.12,
  );
  const metaDiscovery = clamp(analysis * 0.75 + potential * 0.25, 0.9, 1.2);
  const execution = clamp((tactics + analysis) / 2, 0.96, 1.1);

  if (s.role === "Coach") {
    return [
      { labelKey: "staff.lolImpact.development", value: development },
      { labelKey: "staff.lolImpact.tactics", value: tactics },
      { labelKey: "staff.lolImpact.execution", value: execution },
    ];
  }
  if (s.role === "AssistantManager") {
    return [
      { labelKey: "staff.lolImpact.development", value: coaching },
      { labelKey: "staff.lolImpact.tactics", value: tactics },
      { labelKey: "staff.lolImpact.analysis", value: analysis },
    ];
  }
  if (s.role === "Scout") {
    return [
      { labelKey: "staff.lolImpact.analysis", value: analysis },
      { labelKey: "staff.lolImpact.draftAnalysis", value: execution },
      { labelKey: "staff.lolImpact.futureMeta", value: metaDiscovery },
    ];
  }
  if (s.role === "Physio") {
    return [
      { labelKey: "staff.lolImpact.recovery", value: recovery },
      { labelKey: "staff.lolImpact.tiltControl", value: morale },
    ];
  }

  return [
    { labelKey: "staff.lolImpact.development", value: development },
    { labelKey: "staff.lolImpact.analysis", value: analysis },
    { labelKey: "staff.lolImpact.recovery", value: recovery },
  ];
}

export default function StaffTab({ gameState, onGameUpdate, mode = "club" }: StaffTabProps) {
  const { t, i18n } = useTranslation();
  const userTeamId = gameState.manager.team_id;
  const [view, setView] = useState<"mystaff" | "available">("mystaff");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [competitionFilter, setCompetitionFilter] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  console.log("[StaffTab] gameState.staff count:", gameState.staff?.length);
  console.log("[StaffTab] userTeamId:", userTeamId);
  console.log("[StaffTab] staff team_ids:", gameState.staff?.map(s => `${s.first_name} ${s.last_name}: team_id=${s.team_id}`));
  const myStaff = gameState.staff.filter((s) => s.team_id === userTeamId);
  const availableStaff = gameState.staff.filter((s) => !s.team_id);
  console.log("[StaffTab] myStaff count:", myStaff.length);
  console.log("[StaffTab] availableStaff count:", availableStaff.length);

  const handleHire = async (staffId: string) => {
    setActionLoading(staffId);
    try {
      const updated = await hireStaff(staffId);
      onGameUpdate?.(updated);
    } catch (err) {
      console.error("Failed to hire staff:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRelease = async (staffId: string) => {
    setActionLoading(staffId);
    try {
      const updated = await releaseStaff(staffId);
      onGameUpdate?.(updated);
    } catch (err) {
      console.error("Failed to release staff:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const competitionTeamIds = useMemo(() => {
    if (!competitionFilter) return null;
    return new Set(gameState.teams.filter(t => t.competition_id === competitionFilter).map(t => t.id));
  }, [gameState.teams, competitionFilter]);

  const leagueOptions = useMemo(() => {
    return gameState.leagues.map(l => ({ id: l.competition_id ?? l.id, name: l.name }));
  }, [gameState.leagues]);

  const isWorldMode = mode === "world";
  const displayStaff = isWorldMode
    ? gameState.staff
    : view === "mystaff"
      ? myStaff
      : availableStaff;

  const filtered = displayStaff.filter((s) => {
    if (roleFilter && s.role !== roleFilter) return false;
    if (competitionTeamIds && (!s.team_id || !competitionTeamIds.has(s.team_id))) return false;
    if (search.length >= 2) {
      const q = search.toLowerCase();
      const fullName = `${staffDisplayName(s)} ${s.first_name} ${s.last_name}`.toLowerCase();
      if (!fullName.includes(q)) return false;
    }
    return true;
  });

  const roles = useMemo(
    () => Array.from(new Set(gameState.staff.map((s) => s.role))).sort(),
    [gameState.staff],
  );
  const teamEffects = getLolStaffEffectsForTeam(gameState, userTeamId);
  const attrLabel = (key: StaffAttrKey) => t(ATTR_LABEL_KEYS[key]);
  const roleLabel = (role: string) => t(`staff.roles.${role}`, { defaultValue: role });

  return (
    <div className="max-w-5xl mx-auto">
      {/* View toggle */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        {isWorldMode ? (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-2 dark:border-navy-600 dark:bg-navy-800">
            <p className="font-heading text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-gray-100">
              Staff BD
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {filtered.length} de {gameState.staff.length}
            </p>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setView("mystaff")}
              className={`px-4 py-2 rounded-lg font-heading font-bold text-sm uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                view === "mystaff"
                  ? "bg-primary-500 text-white shadow-md shadow-primary-500/20"
                  : "bg-white dark:bg-navy-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-navy-600"
              }`}
            >
              <UserCog className="w-4 h-4" />{" "}
              {t("staff.myStaff", { count: myStaff.length })}
            </button>
            <button
              onClick={() => setView("available")}
              className={`px-4 py-2 rounded-lg font-heading font-bold text-sm uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                view === "available"
                  ? "bg-primary-500 text-white shadow-md shadow-primary-500/20"
                  : "bg-white dark:bg-navy-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-navy-600"
              }`}
            >
              <UserPlus className="w-4 h-4" />{" "}
              {t("staff.available", { count: availableStaff.length })}
            </button>
          </div>
        )}

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder={t("staff.searchStaff")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white dark:bg-navy-800 border border-gray-200 dark:border-navy-600 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          />
        </div>

        <Select
          value={competitionFilter ?? ""}
          onChange={(e) => setCompetitionFilter(e.target.value || null)}
          selectSize="sm"
          className="min-w-32 font-heading font-bold uppercase tracking-wider"
        >
          <option value="">{t("common.all")}</option>
          {leagueOptions.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
        <div className="flex gap-1.5">
          <button
            onClick={() => setRoleFilter(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all ${
              !roleFilter
                ? "bg-primary-500 text-white shadow-sm"
                : "bg-white dark:bg-navy-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-navy-600"
            }`}
          >
            {t("common.all")}
          </button>
          {roles.map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(roleFilter === r ? null : r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all flex items-center gap-1 ${
                roleFilter === r
                  ? "bg-primary-500 text-white shadow-sm"
                  : "bg-white dark:bg-navy-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-navy-600"
              }`}
            >
              {ROLE_ICONS[r] || <UserCog className="w-4 h-4" />} {roleLabel(r)}
            </button>
          ))}
        </div>
      </div>

      {!isWorldMode && view === "mystaff" && myStaff.length > 0 && (
        <Card className="mb-4">
          <CardBody>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-1">
                {t("staff.lolImpactTeamTitle")}
              </span>
              {TEAM_IMPACT_ROWS.map((row) => (
                <span
                  key={row.key}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 dark:bg-primary-500/10 px-2 py-1 text-xs font-heading uppercase tracking-wider text-primary-600 dark:text-primary-300"
                >
                    <span>{t(row.labelKey)}</span>
                  <span className="font-bold tabular-nums">
                    {formatStaffEffectPercent(teamEffects[row.key])}
                  </span>
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Staff grid */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <UserCog className="w-12 h-12 text-gray-300 dark:text-navy-600 mx-auto mb-3" />
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {view === "mystaff"
              ? t("staff.noStaffMatch")
              : t("staff.noAvailableStaff")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((staff) => {
            const roleIcon = ROLE_ICONS[staff.role] || ROLE_ICONS.Coach;
            const roleColor = ROLE_COLORS[staff.role] || ROLE_COLORS.Coach;
            const age = calcAge(staff.date_of_birth, gameState.clock.current_date);
            const ovr = ovrRating(staff);
            const best = bestAttr(staff);
            const impactRows = getStaffImpactRows(staff);
            const photo = resolveStaffPhoto(staff.profile_image_url);

            return (
              <Card key={staff.id}>
                <CardBody>
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div
                      className={`w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center ${roleColor} bg-gray-100 dark:bg-navy-700`}
                    >
                      {photo ? <img src={photo} alt={staffDisplayName(staff)} className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.src = "/default/defaultstaff.webp"; }} /> : roleIcon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-heading font-bold text-sm text-gray-800 dark:text-gray-100 uppercase tracking-wide truncate">
                          {staffDisplayName(staff)}
                        </h3>
                        <Badge
                          variant={
                            ovr >= 65
                              ? "success"
                              : ovr >= 45
                                ? "primary"
                                : "neutral"
                          }
                          size="sm"
                        >
                          {ovr} OVR
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {roleLabel(staff.role)} — {t("common.age")}{" "}
                        {age}
                        <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
                          <CountryFlag
                            code={staff.nationality}
                            locale={i18n.language}
                            className="text-xs leading-none"
                          />
                          <span>{countryName(staff.nationality, i18n.language)}</span>
                        </span>
                        {staff.team_id && (isWorldMode || view === "available") && (
                          <span className="ml-1.5">
                            @ {getTeamName(gameState.teams, staff.team_id)}
                          </span>
                        )}
                      </p>

                      {/* Specialization + Wage */}
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {staff.specialization && (
                          <span className="inline-flex items-center gap-1 text-2xs bg-accent-50 dark:bg-accent-500/10 text-accent-600 dark:text-accent-400 px-1.5 py-0.5 rounded font-heading uppercase tracking-wider">
                            <Star className="w-3 h-3" />{" "}
                            {t(`staff.specializations.${staff.specialization}`)}
                          </span>
                        )}
                        {staff.wage > 0 && (
                          <span className="text-[10px] bg-gray-100 dark:bg-navy-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded font-heading uppercase tracking-wider">
                            {activeCurrencySymbol()}{staff.wage.toLocaleString()}/año
                          </span>
                        )}
                      </div>

                      {/* Attributes */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
                        <AttrBar
                          label={attrLabel("coaching")}
                          value={staff.attributes.coaching}
                        />
                        <AttrBar
                          label={attrLabel("judgingAbility")}
                          value={staff.attributes.judging_ability}
                        />
                        <AttrBar
                          label={attrLabel("judgingPotential")}
                          value={staff.attributes.judging_potential}
                        />
                        <AttrBar
                          label={attrLabel("physiotherapy")}
                          value={staff.attributes.physiotherapy}
                        />
                      </div>

                      <div className="mt-3">
                        <p className="text-2xs font-heading font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                          {t("staff.lolImpactTitle")}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {impactRows.map((row) => (
                            <span
                              key={row.labelKey}
                              className="inline-flex items-center gap-1 rounded bg-navy-50 dark:bg-navy-700/70 px-1.5 py-0.5 text-2xs font-heading uppercase tracking-wider text-gray-600 dark:text-gray-300"
                            >
                              <span>{t(row.labelKey)}</span>
                              <span className="font-bold tabular-nums text-primary-500">
                                {formatStaffEffectPercent(row.value)}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>

                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                        {t("staff.best")}:{" "}
                        <span className="font-medium text-gray-600 dark:text-gray-300">
                          {attrLabel(best.key as StaffAttrKey)} ({best.value})
                        </span>
                      </p>
                    </div>

                    {/* Action button */}
                    {!isWorldMode && view === "mystaff" && (
                      <button
                        disabled={actionLoading === staff.id}
                        onClick={() => handleRelease(staff.id)}
                        className={`p-2 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors ${actionLoading === staff.id ? "opacity-50 pointer-events-none" : ""}`}
                        title={t("staff.releaseStaff")}
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                    {!isWorldMode && view === "available" && (
                      <button
                        disabled={actionLoading === staff.id}
                        onClick={() => handleHire(staff.id)}
                        className={`p-2 rounded-lg bg-primary-50 dark:bg-primary-500/10 text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-colors ${actionLoading === staff.id ? "opacity-50 pointer-events-none" : ""}`}
                        title={t("staff.hireStaff")}
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttrBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span
          className={`font-heading font-bold tabular-nums ${value >= 70 ? "text-primary-500" : value >= 50 ? "text-accent-500" : "text-gray-400"}`}
        >
          {value}
        </span>
      </div>
      <ProgressBar
        value={value}
        variant={value >= 70 ? "success" : value >= 50 ? "primary" : "accent"}
        size="sm"
      />
    </div>
  );
}


