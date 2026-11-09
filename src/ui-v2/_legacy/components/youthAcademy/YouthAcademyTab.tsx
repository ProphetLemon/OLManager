import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap, Search, Sparkles, Star, TrendingUp, Users, ArrowUpDown, ArrowUp, ArrowDown, Info, EyeOff } from "lucide-react";

import { calcAge } from "@/lib/common/helpers";
import { acquireAcademyTeam, getAcademyAcquisitionOptions, promoteAcademyPlayer } from "@/services/academyService";
import type { GameStateData, PlayerData } from "@/store/gameStore";
import { findAcademyTeamForParent, getTeamAcademyRoster } from "@/store/academySelectors";
import type { AcademyAcquisitionOptionData } from "@/store/gameStore";
import { Badge, Button, Card, CardBody, CardHeader } from "@/ui-v2/_legacy/components/ui";
import { resolvePlayerLolRole } from "@/lib/players/lolIdentity";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";
import { activeCurrencySymbol } from "@/lib/formatting/valueFormatting";

interface YouthAcademyTabProps {
  gameState: GameStateData;
  onSelectPlayer?: (id: string) => void;
  onGameUpdate?: (state: GameStateData) => void;
}

type DraftRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

const ACADEMY_LOAD_OPTIONS_ERROR_KEY = "youthAcademy.loadOptionsError";

const LOL_ROLE_ICON_URLS: Record<string, string> = {
  TOP: ROLE_ICON_PATHS.TOP,
  JUNGLE: ROLE_ICON_PATHS.JUNGLE,
  MID: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  SUPPORT: ROLE_ICON_PATHS.SUPPORT,
};

const ROLE_ORDER: Record<DraftRole, number> = {
  TOP: 1,
  JUNGLE: 2,
  MID: 3,
  ADC: 4,
  SUPPORT: 5,
};

function getLolOvr(player: PlayerData): number {
  const attrs = player.attributes;
  const avg =
    (Number(attrs.mechanics ?? 0) +
      Number(attrs.laning ?? 0) +
      Number(attrs.teamfighting ?? 0) +
      Number(attrs.macro_play ?? 0) +
      Number(attrs.consistency ?? 0) +
      Number(attrs.shotcalling ?? 0) +
      Number(attrs.champion_pool ?? 0) +
      Number(attrs.discipline ?? 0) +
      Number(attrs.mental_resilience ?? 0)) /
    9;
  return Math.max(1, Math.min(99, Math.round(avg)));
}

export default function YouthAcademyTab({ gameState, onSelectPlayer, onGameUpdate }: YouthAcademyTabProps) {
  const { t, i18n } = useTranslation();
  const numberLocale = i18n?.language || "en";
  const myTeam = gameState.teams.find((team) => team.id === gameState.manager.team_id);
  const academyTeam = useMemo(
    () => findAcademyTeamForParent(gameState.teams, myTeam?.id),
    [gameState.teams, myTeam?.id],
  );

  const [promotingPlayerId, setPromotingPlayerId] = useState<string | null>(null);
  const [acquisitionOptions, setAcquisitionOptions] = useState<AcademyAcquisitionOptionData[]>([]);
  const [acquisitionBlockedReason, setAcquisitionBlockedReason] = useState<string | null>(null);
  const [acquisitionLoading, setAcquisitionLoading] = useState(false);
  const [acquiringSourceId, setAcquiringSourceId] = useState<string | null>(null);
  const [academyCustomName, setAcademyCustomName] = useState("");
  const [academyCustomShortName, setAcademyCustomShortName] = useState("");
  const [academyCustomLogoUrl, setAcademyCustomLogoUrl] = useState("");

  useEffect(() => {
    let isCancelled = false;

    if (academyTeam || !myTeam?.id) {
      setAcquisitionOptions([]);
      setAcquisitionBlockedReason(null);
      setAcquisitionLoading(false);
      return;
    }

    setAcquisitionLoading(true);
    void getAcademyAcquisitionOptions(myTeam.id)
      .then((response) => {
        if (isCancelled) return;
        setAcquisitionOptions(response.options ?? []);
        setAcquisitionBlockedReason(response.blocked_reason ?? null);
      })
      .catch(() => {
        if (isCancelled) return;
        setAcquisitionOptions([]);
        setAcquisitionBlockedReason(ACADEMY_LOAD_OPTIONS_ERROR_KEY);
      })
      .finally(() => {
        if (isCancelled) return;
        setAcquisitionLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [academyTeam, myTeam?.id]);

  const youthPlayers = useMemo(
    () =>
      (myTeam ? getTeamAcademyRoster(gameState.teams, gameState.players, myTeam.id) : [])
        .map((player) => {
          const role = resolvePlayerLolRole(player);
          const ovr = getLolOvr(player);
          const age = calcAge(player.date_of_birth, gameState.clock.current_date);
          const potential = player.potential_revealed ?? null;
          return { ...player, role, age, ovr, potential };
        })
        .sort((a, b) => {
          const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
          if (byRole !== 0) return byRole;
          const byOvr = b.ovr - a.ovr;
          if (byOvr !== 0) return byOvr;
          return (a.match_name || a.full_name).localeCompare(b.match_name || b.full_name);
        }),
    [gameState.clock.current_date, gameState.players, gameState.teams, myTeam],
  );

  const avgOvr = youthPlayers.length > 0 ? Math.round(youthPlayers.reduce((sum, player) => sum + player.ovr, 0) / youthPlayers.length) : 0;
  const revealedPotentials = youthPlayers
    .map((player) => player.potential)
    .filter((value): value is number => typeof value === "number");
  const avgPotential =
    revealedPotentials.length > 0
      ? Math.round(revealedPotentials.reduce((sum, value) => sum + value, 0) / revealedPotentials.length)
      : null;
  const highPotential = revealedPotentials.filter((value) => value >= 75).length;
  const youthCoach = gameState.staff.filter((staff) => staff.team_id === myTeam?.id && staff.specialization === "Youth");

  type SortKey = "name" | "pos" | "age" | "ovr" | "potential" | "condition";
  const [sortKey, setSortKey] = useState<SortKey>("pos");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "ovr" || key === "potential" || key === "condition" || key === "age" ? "desc" : "asc");
    }
  };

  const sortedPlayers = useMemo(() => {
    return [...youthPlayers].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return dir * (a.match_name || a.full_name).localeCompare(b.match_name || b.full_name);
        case "pos":
          return dir * ((ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99));
        case "age":
          return dir * (a.age - b.age);
        case "ovr":
          return dir * (a.ovr - b.ovr);
        case "potential": {
          const pa = a.potential ?? -1;
          const pb = b.potential ?? -1;
          return dir * (pa - pb);
        }
        case "condition":
          return dir * ((a.condition ?? 0) - (b.condition ?? 0));
        default:
          return 0;
      }
    });
  }, [youthPlayers, sortKey, sortDir]);

  const [searchQuery, setSearchQuery] = useState("");
  const filteredPlayers = useMemo(
    () => sortedPlayers.filter((p) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (p.match_name || "").toLowerCase().includes(q) ||
        (p.full_name || "").toLowerCase().includes(q) ||
        (p.position || "").toLowerCase().includes(q)
      );
    }),
    [sortedPlayers, searchQuery],
  );

  if (!myTeam) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col gap-5">
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("youthAcademy.noYouthPlayers")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      <div className="flex items-center gap-3 flex-wrap">
        {(() => {
          const academyLogo = academyTeam ? resolveTeamLogo(academyTeam.name) : null;
          if (academyLogo) {
            return (
              <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center shrink-0">
                <img src={academyLogo} alt={academyTeam!.name} className="w-9 h-9 object-contain" />
              </div>
            );
          }
          return (
            <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5 text-primary-500" />
            </div>
          );
        })()}
        <h2 className="text-lg font-heading font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wider">
          {t("youthAcademy.title")}
        </h2>
        <Badge variant="neutral" size="sm">
          {`${youthPlayers.length} ${t("youthAcademy.academyPlayers")}`}
        </Badge>
        {academyTeam && (
          <Badge variant="primary" size="sm">
            {academyTeam.name}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardBody>
            <div className="text-center">
              <Users className="w-5 h-5 text-gray-400 dark:text-gray-500 mx-auto mb-1" />
              <p className="font-heading font-bold text-2xl text-gray-800 dark:text-gray-100">{youthPlayers.length}</p>
              <p className="text-2xs text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider">
                {t("youthAcademy.academyPlayersStartingMayus")}
              </p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-center">
              <Star className="w-5 h-5 text-accent-400 mx-auto mb-1" />
              <p className="font-heading font-bold text-2xl text-gray-800 dark:text-gray-100">{avgOvr}</p>
              <div className="w-full max-w-[120px] mx-auto mt-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-navy-600 overflow-hidden">
                <div className="h-full rounded-full bg-accent-400" style={{ width: `${avgOvr}%` }} />
              </div>
              <p className="text-2xs text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider mt-1">
                {t("youthAcademy.avgOvr")}
              </p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-center">
              <TrendingUp className="w-5 h-5 text-green-500 mx-auto mb-1" />
              <p className="font-heading font-bold text-2xl text-gray-800 dark:text-gray-100">
                {avgPotential ?? (
                  <span className="inline-flex items-center gap-1" title={t("youthAcademy.potentialHiddenHint", "Requiere investigación para revelarse")}>
                    ?? <Info className="w-3.5 h-3.5 text-gray-400 inline" />
                  </span>
                )}
              </p>
              {avgPotential != null && (
                <div className="w-full max-w-[120px] mx-auto mt-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-navy-600 overflow-hidden">
                  <div className="h-full rounded-full bg-green-500" style={{ width: `${avgPotential}%` }} />
                </div>
              )}
              <p className="text-2xs text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider mt-1">
                {t("youthAcademy.avgPotential")}
              </p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-center">
              <Sparkles className="w-5 h-5 text-accent-400 mx-auto mb-1" />
              <p className="font-heading font-bold text-2xl text-accent-500">{highPotential}</p>
              {highPotential > 0 && (
                <span className="inline-flex items-center font-bold font-heading uppercase tracking-wider rounded-md bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 px-1.5 py-0.5 text-2xs">
                  {t("youthAcademy.highPotentialBadge", "Talento")}
                </span>
              )}
              <p className="text-2xs text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider mt-1">
                {t("youthAcademy.highPotential")}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {youthCoach.length > 0 && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 text-xs">
              <GraduationCap className="w-3.5 h-3.5 text-primary-500" />
              <span className="text-gray-500 dark:text-gray-400">{t("youthAcademy.youthCoach")}</span>
              {youthCoach.map((staff) => (
                <Badge key={staff.id} variant="primary" size="sm">
                  {staff.first_name} {staff.last_name} ({staff.attributes.coaching})
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {!academyTeam && (
        <Card accent="accent">
          <CardHeader>{t("youthAcademy.academyCardTitle")}</CardHeader>
          <CardBody>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {acquisitionLoading
                  ? t("youthAcademy.acquisitionLoading")
                  : acquisitionOptions.length > 0
                    ? t("youthAcademy.acquisitionIntro")
                    : acquisitionBlockedReason === ACADEMY_LOAD_OPTIONS_ERROR_KEY
                      ? t(ACADEMY_LOAD_OPTIONS_ERROR_KEY)
                      : acquisitionBlockedReason ?? t("youthAcademy.acquisitionNoOptions")}
              </p>
              {acquisitionOptions.length > 0 && (
                <div className="grid gap-2 md:grid-cols-3">
                  <input
                    value={academyCustomName}
                    onChange={(event) => setAcademyCustomName(event.target.value)}
                    placeholder={t("youthAcademy.placeholderCustomName")}
                    className="w-full rounded-lg border border-gray-200 dark:border-navy-600 bg-white/80 dark:bg-navy-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
                  />
                  <input
                    value={academyCustomShortName}
                    onChange={(event) => setAcademyCustomShortName(event.target.value)}
                    placeholder={t("youthAcademy.placeholderCustomShortName")}
                    className="w-full rounded-lg border border-gray-200 dark:border-navy-600 bg-white/80 dark:bg-navy-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
                  />
                  <input
                    value={academyCustomLogoUrl}
                    onChange={(event) => setAcademyCustomLogoUrl(event.target.value)}
                    placeholder={t("youthAcademy.placeholderCustomLogoUrl")}
                    className="w-full rounded-lg border border-gray-200 dark:border-navy-600 bg-white/80 dark:bg-navy-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
                  />
                </div>
              )}
              {acquisitionOptions.length === 0 && (
                <Button size="sm" variant="outline" disabled>
                  {t("youthAcademy.fundAcademy")}
                </Button>
              )}
              {acquisitionOptions.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {acquisitionOptions.map((option) => {
                    const optionLogoSrc = option.source_team_logo_url ?? resolveTeamLogo(option.source_team_name);

                    return (
                    <div key={option.source_team_id} className="rounded-lg border border-gray-100 dark:border-navy-600 p-4 flex items-center gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-navy-700/40 border border-navy-600 flex items-center justify-center overflow-hidden shrink-0">
                          {optionLogoSrc ? (
                            <img
                              src={optionLogoSrc}
                              alt={t("youthAcademy.sourceTeamLogoAlt", { team: option.source_team_name })}
                              className="w-8 h-8 object-contain"
                              loading="lazy"
                            />
                          ) : (
                            <span className="text-2xs font-heading text-gray-300">{option.source_team_short_name}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{option.source_team_name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {option.league_name} · {option.country} · {activeCurrencySymbol()}{option.acquisition_cost.toLocaleString(numberLocale)}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 min-w-[130px]"
                        disabled={acquiringSourceId === option.source_team_id}
                        onClick={async () => {
                          if (!myTeam?.id) return;
                          try {
                            setAcquiringSourceId(option.source_team_id);
                            const updated = await acquireAcademyTeam({
                              parent_team_id: myTeam.id,
                              source_team_id: option.source_team_id,
                              custom_name: academyCustomName.trim() || undefined,
                              custom_short_name: academyCustomShortName.trim() || undefined,
                              custom_logo_url: academyCustomLogoUrl.trim() || undefined,
                            });
                            onGameUpdate?.(updated);
                          } finally {
                            setAcquiringSourceId(null);
                          }
                        }}
                      >
                        {acquiringSourceId === option.source_team_id
                          ? t("youthAcademy.fundingAcademy")
                          : t("youthAcademy.fundAcademy")}
                      </Button>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          {academyTeam ? t("youthAcademy.academyRosterLinked") : t("youthAcademy.academyNotLinked")}
        </CardHeader>
        <CardBody className="p-0">
          {youthPlayers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <GraduationCap className="w-10 h-10 text-gray-300 dark:text-navy-600" />
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("youthAcademy.noYouthPlayers")}</p>
            </div>
          ) : (
            <>
              {/* Search bar */}
              <div className="relative px-4 pt-4 pb-2">
                <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("youthAcademy.searchPlaceholder", "Buscar por nombre o posición...")}
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-navy-700 border border-gray-200 dark:border-navy-600 rounded-lg text-gray-800 dark:text-gray-100 placeholder-gray-400"
                />
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-navy-800 border-b border-gray-200 dark:border-navy-600 text-xs">
                  <th className="py-3 px-4 w-14" />
                  <th
                    className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-300 transition-colors"
                    onClick={() => toggleSort("name")}
                  >
                    <span className="inline-flex items-center gap-1">
                      {t("youthAcademy.player")}
                      {sortKey === "name" ? (
                        sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </span>
                  </th>
                  <th
                    className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-300 transition-colors"
                    onClick={() => toggleSort("pos")}
                  >
                    <span className="inline-flex items-center gap-1">
                      {t("youthAcademy.pos")}
                      {sortKey === "pos" ? (
                        sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </span>
                  </th>
                  <th
                    className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-300 transition-colors"
                    onClick={() => toggleSort("age")}
                  >
                    <span className="inline-flex items-center gap-1 justify-center">
                      {t("youthAcademy.age")}
                      {sortKey === "age" ? (
                        sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </span>
                  </th>
                  <th
                    className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-300 transition-colors"
                    onClick={() => toggleSort("ovr")}
                  >
                    <span className="inline-flex items-center gap-1 justify-center">
                      {t("youthAcademy.ovr")}
                      {sortKey === "ovr" ? (
                        sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </span>
                  </th>
                  <th
                    className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-300 transition-colors"
                    onClick={() => toggleSort("potential")}
                  >
                    <span className="inline-flex items-center gap-1 justify-center">
                      {t("youthAcademy.potential")}
                      {sortKey === "potential" ? (
                        sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </span>
                  </th>
                  <th
                    className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-300 transition-colors"
                    onClick={() => toggleSort("condition")}
                  >
                    <span className="inline-flex items-center gap-1 justify-center">
                      {t("youthAcademy.condition")}
                      {sortKey === "condition" ? (
                        sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                    </span>
                  </th>
                  <th className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
                {filteredPlayers.map((player) => {
                  const photoUrl = resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url);
                  return (
                    <tr
                      key={player.id}
                      onClick={() => onSelectPlayer?.(player.id)}
                      className="hover:bg-gray-50 dark:hover:bg-navy-700/50 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        {photoUrl ? (
                          <img
                            src={photoUrl}
                            alt={player.match_name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-navy-600 flex items-center justify-center text-xs font-heading font-bold text-gray-500 dark:text-gray-400">
                            {player.match_name?.charAt(0)?.toUpperCase() ?? "?"}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{player.match_name || player.id}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{player.full_name}</p>
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <img
                          src={LOL_ROLE_ICON_URLS[player.position as DraftRole] ?? LOL_ROLE_ICON_URLS.TOP}
                          alt={player.position}
                          className="w-5 h-5 object-contain"
                          title={player.position}
                        />
                      </td>
                      <td className="py-2.5 px-4 text-center text-sm text-gray-700 dark:text-gray-300">{player.age}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="font-heading font-bold text-gray-800 dark:text-gray-100">{player.ovr}</span>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {player.potential != null ? (
                          <span className="font-heading font-bold text-accent-500">{player.potential}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-accent-500/60" title={t("youthAcademy.potentialHiddenHint", "Potencial oculto — requiere investigación")}>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span className="text-2xs font-heading font-bold">{t("youthAcademy.hidden", "Oculto")}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <div className="flex items-center gap-1.5 justify-center">
                          <div className="w-10 h-1.5 rounded-full bg-gray-200 dark:bg-navy-600 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${(player.condition ?? 0) >= 70 ? "bg-success-400" : (player.condition ?? 0) >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${player.condition ?? 0}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium tabular-nums text-gray-700 dark:text-gray-300">
                            {player.condition}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <Button
                          size="sm"
                          variant={promotingPlayerId === player.id ? "outline" : "primary"}
                          disabled={promotingPlayerId === player.id}
                          title={promotingPlayerId === player.id ? t("youthAcademy.promoting", "Subiendo...") : t("youthAcademy.promoteTitle", "Promocionar al primer equipo")}
                          onClick={async (event) => {
                            event.stopPropagation();
                            try {
                              setPromotingPlayerId(player.id);
                              const updated = await promoteAcademyPlayer(player.id);
                              onGameUpdate?.(updated);
                            } finally {
                              setPromotingPlayerId(null);
                            }
                          }}
                        >
                          {promotingPlayerId === player.id ? t("youthAcademy.promoting") : t("youthAcademy.promote")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}


