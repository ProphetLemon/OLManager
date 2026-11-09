import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Save, X } from "lucide-react";

import { Button } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/ui-v2/components/ui/dialog";

interface DashboardExitConfirmModalProps {
  onCancel: () => void;
  onConfirm: () => void;
  onExitWithoutSave?: () => void;
}

export default function DashboardExitConfirmModal({
  onCancel,
  onConfirm,
  onExitWithoutSave,
}: DashboardExitConfirmModalProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent aria-modal="true" className="max-w-sm">
        <div className="flex items-start justify-between">
          <DialogTitle className="text-lg text-foreground">
            {t("exitConfirm.title")}
          </DialogTitle>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("common.close", { defaultValue: "Close" })}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("exitConfirm.message", {
            defaultValue:
              "Save & Exit keeps your progress. Exit without saving discards everything since your last save.",
          })}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button type="button" variant="club" size="touch" onClick={onConfirm} className="w-full font-heading font-bold uppercase tracking-wider">
            <Save className="size-4" aria-hidden="true" />
            {t("exitConfirm.saveExit")}
          </Button>
          {onExitWithoutSave && (
            <Button
              type="button"
              variant="destructive"
              size="touch"
              onClick={onExitWithoutSave}
              className="w-full font-heading font-bold uppercase tracking-wider"
            >
              <LogOut className="size-4" aria-hidden="true" />
              {t("exitConfirm.exitNoSave", { defaultValue: "Exit without saving" })}
            </Button>
          )}
          <Button type="button" variant="outline" size="touch" onClick={onCancel} className="w-full font-heading font-bold uppercase tracking-wider text-muted-foreground">
            {t("common.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
