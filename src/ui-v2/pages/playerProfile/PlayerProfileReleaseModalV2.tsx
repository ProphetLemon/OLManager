import DashboardModalFrame from "@/ui-v2/_legacy/components/dashboard/DashboardModalFrame";
import { formatVal } from "@/lib/common/helpers";
import { Button } from "@/ui-v2/components/ui/button";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

interface PlayerProfileReleaseModalV2Props {
  t: TranslateFn;
  penalty: number;
  error: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PlayerProfileReleaseModalV2({
  t,
  penalty,
  error,
  submitting,
  onCancel,
  onConfirm,
}: PlayerProfileReleaseModalV2Props) {
  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div className="space-y-4">
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-foreground">
          {t("playerProfile.releaseContract")}
        </h3>
        <p className="text-sm text-foreground/70">{t("playerProfile.releaseContractConfirm")}</p>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {t("playerProfile.releasePenalty", { defaultValue: "Termination cost" })}
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-destructive">{formatVal(penalty)}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={submitting}>
            {t("playerProfile.releaseContract")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
