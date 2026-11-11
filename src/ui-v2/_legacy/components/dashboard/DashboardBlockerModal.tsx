import { AlertCircle, X } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { BlockerModal } from "@/hooks/useAdvanceTime.helpers";
import { canContinueAnyway } from "@/lib/home/blockerRules";
import { Dialog, DialogContent, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { navLabelFor, resolveNavTab } from "@/ui-v2/shell/navModel";
import { cn } from "@/ui-v2/lib/utils";

interface DashboardBlockerModalProps {
  blockerModal: BlockerModal;
  onClose: () => void;
  onContinueAnyway: (() => void) | null;
  onNavigate: (tab: string) => void;
}

function blockerBorder(severity: string): string {
  return severity === "warn"
    ? "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
    : "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10";
}

function blockerTextColor(severity: string): string {
  return severity === "warn" ? "text-amber-400" : "text-blue-400";
}

export default function DashboardBlockerModal({
  blockerModal,
  onClose,
  onContinueAnyway,
  onNavigate,
}: DashboardBlockerModalProps): JSX.Element {
  const { t } = useTranslation();
  const destinationName = (tab: string): string => {
    const label = navLabelFor(tab);
    return label ? t(label.labelKey, { defaultValue: label.defaultLabel }) : tab;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-modal="true">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20">
            <AlertCircle className="size-5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between">
              <DialogTitle className="text-lg text-foreground">
                {t("notifications.attentionRequired")}
              </DialogTitle>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close", { defaultValue: "Close" })}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("notifications.resolveBeforeContinuing")}
            </p>
          </div>
        </div>

        <div className="mb-5 flex flex-col gap-2">
          {blockerModal.blockers.map((blocker) => (
            <button
              key={blocker.id}
              type="button"
              onClick={() => onNavigate(resolveNavTab(blocker.tab))}
              className={cn("w-full rounded-xl border p-3 text-left transition-all hover:shadow-sm", blockerBorder(blocker.severity))}
            >
              <p className={cn("text-sm font-medium", blockerTextColor(blocker.severity))}>
                {blocker.text}
              </p>
              <p className="mt-1 font-heading text-2xs uppercase tracking-widest text-muted-foreground/60">
                {t("notifications.goTo")} {destinationName(blocker.tab)} →
              </p>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted"
          >
            {t("notifications.reviewIssues")}
          </button>
          {onContinueAnyway && canContinueAnyway(blockerModal.blockers) && (
            <button
              type="button"
              onClick={onContinueAnyway}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("notifications.continueAnyway")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
