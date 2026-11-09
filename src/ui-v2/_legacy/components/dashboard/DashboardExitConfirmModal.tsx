import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Save, X } from "lucide-react";

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
          {t("exitConfirm.message")}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Save className="size-4" aria-hidden="true" />
            {t("exitConfirm.saveExit")}
          </button>
          {onExitWithoutSave && (
            <button
              type="button"
              onClick={onExitWithoutSave}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wider text-destructive-foreground transition-colors hover:bg-destructive/90"
            >
              <LogOut className="size-4" aria-hidden="true" />
              {t("exitConfirm.exitNoSave", { defaultValue: "Exit without saving" })}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted"
          >
            {t("common.cancel")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
