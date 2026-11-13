import DashboardAlerts from "@/ui-v2/_legacy/components/dashboard/DashboardAlerts";
import type { DashboardAlert } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";
import DashboardTabContent from "@/ui-v2/_legacy/components/dashboard/DashboardTabContent";
import type { DashboardTabContentModel } from "@/ui-v2/_legacy/components/dashboard/dashboardTabContentModel";
import { ShieldX } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DashboardWorkspaceContentProps {
  dashboardAlerts: DashboardAlert[];
  dashboardTabContentModel: DashboardTabContentModel;
  onNavigate: (tab: string) => void;
  isUnemployed: boolean;
}

export default function DashboardWorkspaceContent({
  dashboardAlerts,
  dashboardTabContentModel,
  onNavigate,
  isUnemployed,
}: DashboardWorkspaceContentProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 bg-gray-100 dark:bg-navy-900">
      {isUnemployed && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <ShieldX className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {t("dashboard.unemployedBanner")}
          </p>
        </div>
      )}

      <DashboardAlerts alerts={dashboardAlerts} onNavigate={onNavigate} />
      <div className="flex flex-col gap-4">
        <DashboardTabContent viewModel={dashboardTabContentModel} />
      </div>
    </div>
  );
}
