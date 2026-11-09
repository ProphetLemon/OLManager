import { Calendar, MapPin, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { countryName } from "@/lib/common/countries";
import { defaultTeamLogoSrc, formatLeaguePosition } from "@/lib/teamProfile/clubInfo";
import { resolveTeamProfileLogo } from "@/lib/teamProfile/logo";
import type { TeamProfileViewModel } from "@/lib/teamProfile/types";
import type { TeamData } from "@/store/gameStore";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";
import { Card } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";

interface TeamProfileHeroCardV2Props {
  team: TeamData;
  viewModel: TeamProfileViewModel;
}

function HeroStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-[100px] rounded-xl bg-black/20 px-5 py-3 text-center backdrop-blur">
      <p className="font-heading text-xs uppercase tracking-wider text-white/60">{label}</p>
      <p className={cn("mt-0.5 font-heading text-2xl font-bold tabular-nums text-white", valueClassName)}>
        {value}
      </p>
    </div>
  );
}

function MobileStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card p-3 text-center">
      <p className="font-heading text-xs uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-heading text-lg font-bold tabular-nums",
          accent ? "text-club-text" : "text-foreground/90",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export default function TeamProfileHeroCardV2({ team, viewModel }: TeamProfileHeroCardV2Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const fallbackLogoSrc = useMemo(() => defaultTeamLogoSrc(team.id), [team.id]);
  const resolvedLogo = resolveTeamProfileLogo(team);
  const [logoSrc, setLogoSrc] = useState(resolvedLogo);

  useEffect(() => {
    setLogoSrc(resolvedLogo);
  }, [resolvedLogo]);

  const leaguePos = formatLeaguePosition(viewModel);
  const avgOvr = String(viewModel.avgOvr);
  const squadSize = String(viewModel.roster.length);
  const reputation = String(team.reputation);

  return (
    <Card className="mb-5 gap-0 overflow-hidden py-0">
      <div
        className="relative p-6 md:p-8"
        style={{
          background: `linear-gradient(135deg, ${team.colors.primary}, ${team.colors.secondary}40)`,
        }}
      >
        <div className="flex items-start gap-6">
          <div
            className="flex size-24 shrink-0 items-center justify-center rounded-2xl border-2 border-white/30 font-heading text-3xl font-bold text-white"
            style={{ backgroundColor: team.colors.primary }}
          >
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={`${team.name} logo`}
                className="size-16 object-contain [filter:drop-shadow(0_4px_6px_rgba(0,0,0,0.8))]"
                loading="lazy"
                onError={() => {
                  if (logoSrc !== fallbackLogoSrc) {
                    setLogoSrc(fallbackLogoSrc);
                    return;
                  }
                  setLogoSrc("");
                }}
              />
            ) : (
              <span className="text-sm font-bold uppercase tracking-wide">{team.short_name}</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-3xl font-bold uppercase tracking-wide text-white drop-shadow">
              {team.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-white/80">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" />
                <CountryFlag code={team.country} locale={locale} className="text-sm leading-none" />
                <span>
                  {team.city}, {countryName(team.country, locale)}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="size-4" /> {t("teams.est")} {team.founded_year}
              </span>
            </div>
            {team.competition_id && (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-white/80">
                <img
                  src={`/competitions-icons/${team.competition_id}.webp`}
                  alt={team.competition_id}
                  className="size-4 object-contain"
                />
                {team.competition_id.toUpperCase()}
              </div>
            )}
            {viewModel.manager && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/70">
                <Users className="size-4" /> {t("teamProfile.managerLabel")}{" "}
                {viewModel.manager.first_name} {viewModel.manager.last_name}
              </p>
            )}
          </div>

          <div className="hidden grid-cols-2 gap-3 md:grid">
            <HeroStat label={t("teams.avgOvr")} value={avgOvr} />
            <HeroStat label={t("manager.reputation")} value={reputation} valueClassName="text-club-text" />
            <HeroStat label={t("teamProfile.leaguePos")} value={leaguePos} />
            <HeroStat label={t("teams.squad")} value={squadSize} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px bg-muted md:hidden">
        <MobileStat label={t("teams.avgOvr")} value={avgOvr} accent />
        <MobileStat label={t("teams.rep")} value={reputation} accent />
        <MobileStat label={t("common.position")} value={leaguePos} />
        <MobileStat label={t("teams.squad")} value={squadSize} />
      </div>
    </Card>
  );
}
