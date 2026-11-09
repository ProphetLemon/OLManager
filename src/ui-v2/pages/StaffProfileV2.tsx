import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  ChevronLeft,
  Eye,
  GraduationCap,
  Loader2,
  Star,
  Stethoscope,
  UserMinus,
  UserPlus,
} from "lucide-react";

import type { GameStateData } from "@/store/gameStore";
import { hireStaff, releaseStaff } from "@/services/staffService";
import {
  formatStaffEffectPercent,
} from "@/lib/teams/lolStaffEffects";
import { resolveStaffPhoto } from "@/lib/players/playerPhotos";
import { staffDisplayName } from "@/lib/staff/staffName";
import {
  ATTR_LABEL_KEYS,
  bestAttr,
  getStaffImpactRows,
  ovrRating,
  type StaffAttrKey,
} from "@/lib/staff/staffStats";
import { calcAge, getTeamName } from "@/lib/common/helpers";
import { countryName } from "@/lib/common/countries";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";
import { Card, CardContent } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { activeCurrencySymbol } from "@/lib/formatting/valueFormatting";

const ROLE_ICONS: Record<string, React.ReactNode> = {
  AssistantManager: <Briefcase className="size-5" />,
  Coach: <GraduationCap className="size-5" />,
  Scout: <Eye className="size-5" />,
  Physio: <Stethoscope className="size-5" />,
  Owner: <Star className="size-5" />,
};

interface StaffProfileV2Props {
  gameState: GameStateData;
  staffId: string;
  onClose: () => void;
  onGameUpdate?: (state: GameStateData) => void;
  onSelectTeam?: (id: string) => void;
}

function AttrBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = value >= 70 ? "bg-positive" : value >= 50 ? "bg-warning" : "bg-muted-foreground/40";
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-heading font-bold tabular-nums ${value >= 70 ? "text-positive" : value >= 50 ? "text-warning" : "text-muted-foreground"}`}>
          {value}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function StaffProfileV2({
  gameState,
  staffId,
  onClose,
  onGameUpdate,
  onSelectTeam,
}: StaffProfileV2Props) {
  const { t, i18n } = useTranslation();
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staff = gameState.staff.find((s) => s.id === staffId);
  if (!staff) return null;

  const ovr = ovrRating(staff);
  const best = bestAttr(staff);
  const impactRows = getStaffImpactRows(staff);
  const age = calcAge(staff.date_of_birth, gameState.clock.current_date);
  const attrLabel = (key: StaffAttrKey) => t(ATTR_LABEL_KEYS[key]);
  const photo = resolveStaffPhoto(staff.profile_image_url);
  const roleIcon = ROLE_ICONS[staff.role] ?? <UserPlus className="size-5" />;

  const managerTeamId = gameState.manager.team_id;
  const isOwnStaff = managerTeamId != null && staff.team_id === managerTeamId;
  const isFreeAgent = !staff.team_id;
  const canHire = isFreeAgent && managerTeamId != null;
  const realName = `${staff.first_name} ${staff.last_name}`.trim();
  const hasNickname = !!staff.nickname?.trim();

  const runAction = async (fn: (id: string) => Promise<GameStateData>) => {
    setActionLoading(true);
    setError(null);
    try {
      const updated = await fn(staffId);
      onGameUpdate?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-v2 p-6">
      <button
        type="button"
        onClick={onClose}
        className="mb-4 inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {t("common.back", { defaultValue: "Volver" })}
      </button>

      {/* Hero */}
      <Card>
        <CardContent className="flex flex-wrap items-start gap-5">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted text-muted-foreground">
            {photo ? (
              <img src={photo} alt={staffDisplayName(staff)} className="size-full object-cover" onError={(e) => { e.currentTarget.src = "/default/defaultstaff.webp"; }} />
            ) : (
              roleIcon
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-2xl font-bold uppercase tracking-wide text-foreground">
                {staffDisplayName(staff)}
              </h1>
              <Badge
                variant={ovr >= 65 ? "default" : ovr >= 45 ? "secondary" : "outline"}
                className="text-xs"
              >
                {ovr} OVR
              </Badge>
            </div>

            {hasNickname && realName && (
              <p className="mt-0.5 text-sm text-muted-foreground">{realName}</p>
            )}

            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                {roleIcon}
                {t(`staff.roles.${staff.role}`, { defaultValue: staff.role })}
              </span>
              <span className="text-border">·</span>
              <span>{t("common.age")} {age}</span>
              {staff.nationality && (
                <>
                  <span className="text-border">·</span>
                  <span className="inline-flex items-center gap-1">
                    <CountryFlag code={staff.nationality} locale={i18n.language} className="text-base leading-none" />
                    <span>{countryName(staff.nationality, i18n.language)}</span>
                  </span>
                </>
              )}
              {staff.team_id && (
                <>
                  <span className="text-border">·</span>
                  <button
                    type="button"
                    onClick={() => onSelectTeam?.(staff.team_id as string)}
                    className="text-muted-foreground/80 underline-offset-2 hover:text-primary hover:underline"
                  >
                    {getTeamName(gameState.teams, staff.team_id)}
                  </button>
                </>
              )}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {staff.specialization && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-heading text-caption uppercase tracking-wider text-muted-foreground">
                  <Star className="size-3" /> {t(`staff.specializations.${staff.specialization}`)}
                </span>
              )}
              {staff.wage > 0 && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-heading text-caption uppercase tracking-wider text-muted-foreground">
                  {activeCurrencySymbol()}{staff.wage.toLocaleString()}/año
                </span>
              )}
              {staff.contract_end && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-heading text-caption uppercase tracking-wider text-muted-foreground">
                  {t("staff.contractUntil", { defaultValue: "Contrato" })}: {staff.contract_end}
                </span>
              )}
            </div>
          </div>

          {/* Action */}
          {(canHire || isOwnStaff) && (
            <div className="flex shrink-0 flex-col items-end gap-1">
              {isOwnStaff ? (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => runAction(releaseStaff)}
                  className="inline-flex items-center gap-2 rounded-lg bg-negative/10 px-4 py-2 font-heading text-sm font-bold uppercase tracking-wider text-negative transition-colors hover:bg-negative/20 disabled:pointer-events-none disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
                  {t("staff.releaseStaff")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => runAction(hireStaff)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 font-heading text-sm font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                  {t("staff.hireStaff")}
                </button>
              )}
              {error && <p className="max-w-[220px] text-right text-xs text-negative">{error}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attributes */}
      <Card className="mt-4">
        <CardContent>
          <h2 className="mb-3 font-heading text-sm font-bold uppercase tracking-wider text-foreground">
            {t("staff.attributes", { defaultValue: "Atributos" })}
          </h2>
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <AttrBar label={attrLabel("coaching")} value={staff.attributes.coaching} />
            <AttrBar label={attrLabel("judgingAbility")} value={staff.attributes.judging_ability} />
            <AttrBar label={attrLabel("judgingPotential")} value={staff.attributes.judging_potential} />
            <AttrBar label={attrLabel("physiotherapy")} value={staff.attributes.physiotherapy} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("staff.best")}:{" "}
            <span className="font-medium text-foreground">
              {attrLabel(best.key as StaffAttrKey)} ({best.value})
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Impact */}
      {impactRows.length > 0 && (
        <Card className="mt-4">
          <CardContent>
            <h2 className="mb-3 font-heading text-sm font-bold uppercase tracking-wider text-foreground">
              {t("staff.lolImpact.title", { defaultValue: "Impacto" })}
            </h2>
            <div className="flex flex-wrap gap-2">
              {impactRows.map((row) => (
                <span
                  key={row.labelKey}
                  className="inline-flex items-center gap-1.5 rounded bg-primary/5 px-2.5 py-1 font-heading text-xs uppercase tracking-wider text-muted-foreground"
                >
                  <span>{t(row.labelKey)}</span>
                  <span className="font-bold text-primary tabular-nums">
                    {formatStaffEffectPercent(row.value)}
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
