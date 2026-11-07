import { Building2, DollarSign, Trophy, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatVal } from "@/lib/common/helpers";
import { formatWinRate, resolveErlLeagueName } from "@/lib/teamProfile/clubInfo";
import type { LeagueStanding, TeamProfileViewModel } from "@/lib/teamProfile/types";
import type { TeamData } from "@/store/gameStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { InfoRow, StatBox } from "@/ui-v2/pages/teamProfile/TeamProfilePrimitivesV2";

const ICON = "size-4";

export function TeamProfileClubDetailsCardV2({
  team,
  rosterSize,
}: {
  team: TeamData;
  rosterSize: number;
}) {
  const { t } = useTranslation();
  const erlLeagueName = resolveErlLeagueName(team);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bold uppercase tracking-wider">{t("teamProfile.clubInfo")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <InfoRow
          icon={<Building2 className={ICON} />}
          label={erlLeagueName ? t("teamProfile.erl") : t("teamProfile.hq")}
          value={erlLeagueName ?? team.city}
        />
        <InfoRow
          icon={<Users className={ICON} />}
          label={t("teamProfile.activeRoster")}
          value={String(rosterSize)}
        />
      </CardContent>
    </Card>
  );
}

export function TeamProfileSummaryCardV2({
  team,
  isOwnTeam,
  viewModel,
}: {
  team: TeamData;
  isOwnTeam: boolean;
  viewModel: TeamProfileViewModel;
}) {
  const { t } = useTranslation();

  if (isOwnTeam) {
    const money = <DollarSign className={ICON} />;
    return (
      <Card className="ring-primary/30">
        <CardHeader>
          <CardTitle className="font-bold uppercase tracking-wider">{t("dashboard.finances")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <InfoRow icon={money} label={t("teamProfile.balance")} value={formatVal(team.finance)} />
          <InfoRow
            icon={money}
            label={t("finances.wageBudget")}
            value={`${formatVal(team.wage_budget)} /año`}
          />
          <InfoRow
            icon={money}
            label={t("finances.transferBudget")}
            value={formatVal(team.transfer_budget)}
          />
          <InfoRow
            icon={money}
            label={t("teamProfile.totalWages")}
            value={`${formatVal(viewModel.totalWages)} /año`}
          />
          <InfoRow
            icon={money}
            label={t("finances.squadValue")}
            value={formatVal(viewModel.totalValue)}
          />
          <InfoRow
            icon={money}
            label={t("finances.seasonIncome")}
            value={formatVal(team.season_income)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bold uppercase tracking-wider">{t("teamProfile.squadOverview")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <InfoRow
          icon={<Users className={ICON} />}
          label={t("teamProfile.squadSize")}
          value={String(viewModel.roster.length)}
        />
        <InfoRow
          icon={<DollarSign className={ICON} />}
          label={t("finances.squadValue")}
          value={formatVal(viewModel.totalValue)}
        />
        <InfoRow
          icon={<Trophy className={ICON} />}
          label={t("teams.avgOvr")}
          value={String(viewModel.avgOvr)}
        />
      </CardContent>
    </Card>
  );
}

export function TeamProfileLeagueStandingCardV2({
  standings,
}: {
  standings: LeagueStanding | null;
}) {
  const { t } = useTranslation();
  if (!standings) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bold uppercase tracking-wider">{t("teamProfile.leagueStanding")}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2 text-center">
        <StatBox label={t("common.played")} value={standings.played} />
        <StatBox label={t("common.won")} value={standings.won} />
        <StatBox label={t("common.lost")} value={standings.lost} />
        <StatBox label={t("teamProfile.winRate")} value={formatWinRate(standings.won, standings.lost)} />
        <StatBox
          label={`${t("common.won")}-${t("common.lost")}`}
          value={`${standings.won}-${standings.lost}`}
          highlight
        />
      </CardContent>
    </Card>
  );
}
