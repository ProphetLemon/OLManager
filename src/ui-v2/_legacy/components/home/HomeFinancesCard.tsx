import { useTranslation } from "react-i18next";

import type { TeamData } from "@/store/gameStore";
import { Card, CardBody, CardHeader } from "@/ui-v2/_legacy/components/ui";
import { activeCurrencySymbol } from "@/lib/formatting/valueFormatting";

interface HomeFinancesCardProps {
  team: TeamData;
  onNavigate?: (tab: string) => void;
}

function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${value >= 0 ? "+" : ""}${activeCurrencySymbol()}${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${value >= 0 ? "+" : ""}${activeCurrencySymbol()}${(value / 1_000).toFixed(0)}K`;
  }
  return `${value >= 0 ? "+" : ""}${activeCurrencySymbol()}${Math.round(value)}`;
}

export default function HomeFinancesCard({ team, onNavigate }: HomeFinancesCardProps) {
  const { t } = useTranslation();

  const monthlyNet = team.season_income - team.season_expenses;
  const projected = team.finance + monthlyNet;

  return (
    <Card>
      <CardHeader
        action={
          <button
            onClick={() => onNavigate?.("Finances")}
            className="text-primary-500 dark:text-primary-400 text-xs font-heading font-bold uppercase tracking-wider hover:text-primary-600 dark:hover:text-primary-300 transition-colors"
          >
            {t("dashboard.finances")}
          </button>
        }
      >
        {t("dashboard.finances")}
      </CardHeader>
      <CardBody>
        <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-heading">
          {t("home.projectedBalance")}
        </p>
        <p className={`mt-1 text-4xl leading-none font-heading font-bold ${projected >= 0 ? "text-green-500" : "text-red-500"}`}>
          {projected >= 0 ? "" : "-"}{activeCurrencySymbol()}
          {Math.abs(Math.round(projected / 1_000_000))}M
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {t("home.rawCash")}: {formatCompactCurrency(team.finance)}
        </p>

        <div className="mt-6 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">
              {t("home.monthlyNet")}
            </span>
            <span className={`font-heading font-bold ${monthlyNet >= 0 ? "text-green-500" : "text-red-500"}`}>
              {formatCompactCurrency(monthlyNet)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">
              {t("home.income")}
            </span>
            <span className="font-heading font-bold text-green-500">
              {formatCompactCurrency(team.season_income)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">
              {t("home.expenses")}
            </span>
            <span className="font-heading font-bold text-red-500">
              {formatCompactCurrency(-Math.abs(team.season_expenses))}
            </span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
