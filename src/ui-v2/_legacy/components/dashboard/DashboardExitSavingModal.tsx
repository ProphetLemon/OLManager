import type { JSX } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogTitle } from "@/ui-v2/components/ui/dialog";

export default function DashboardExitSavingModal(): JSX.Element {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent aria-modal="true" className="max-w-sm">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300">
          <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
        </div>
        <DialogTitle className="mt-4 text-lg text-foreground">
          {t("exitConfirm.savingTitle")}
        </DialogTitle>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {t("exitConfirm.savingMessage")}
        </p>
      </div>
    </DialogContent>
    </Dialog>
  );
}
