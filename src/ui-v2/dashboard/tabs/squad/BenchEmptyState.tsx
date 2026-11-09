import { Armchair } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/ui-v2/components/ui/button"

interface BenchEmptyStateProps {
  /** True when players exist but the active role filter hides all of them. */
  filtered: boolean
  onBrowseMarket: () => void
  onOpenAcademy: () => void
  onClearFilter?: () => void
}

/** One inline row: icon, message, actions. It wraps rather than stacking by default. */
export function BenchEmptyState({
  filtered,
  onBrowseMarket,
  onOpenAcademy,
  onClearFilter,
}: BenchEmptyStateProps) {
  const { t } = useTranslation()

  return (
    <div
      data-slot="bench-empty-state"
      data-variant={filtered ? "filtered" : "empty"}
      className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 rounded-xl border border-dashed border-line bg-card/60 px-5 py-4"
    >
      <Armchair aria-hidden="true" className="size-8 shrink-0 text-club-text" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-base font-semibold text-card-foreground">
          {filtered
            ? t("onAir.squad.benchFilteredTitle", { defaultValue: "No bench players for this role" })
            : t("onAir.squad.benchEmptyTitle", { defaultValue: "The bench is empty" })}
        </h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          {filtered
            ? t("onAir.squad.benchFilteredBody", {
                defaultValue:
                  "No bench player matches this role filter. Try another role or clear the filter.",
              })
            : t("onAir.squad.benchEmptyBody", {
                defaultValue: "Sign players from the market or promote talent from your academy.",
              })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {filtered ? (
          onClearFilter ? (
            <Button type="button" variant="club" size="touch" onClick={onClearFilter}>
              {t("onAir.squad.clearFilter", { defaultValue: "Clear filter" })}
            </Button>
          ) : null
        ) : (
          <>
            <Button type="button" variant="club" size="touch" onClick={onBrowseMarket}>
              {t("onAir.squad.browseMarket", { defaultValue: "Browse market" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="text-club-text"
              onClick={onOpenAcademy}
            >
              {t("onAir.squad.openAcademy", { defaultValue: "Open academy" })}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
