import { X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/ui-v2/components/ui/button"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"
import type { PlayerCardModel } from "@/lib/squad/cards"

interface SelectedPlayerBarProps {
  model: PlayerCardModel
  onOpenProfile: (id: string) => void
  onRenew: (id: string) => void
  onToggleTransferList: (id: string) => void
  onClose: () => void
}

export function SelectedPlayerBar({
  model,
  onOpenProfile,
  onRenew,
  onToggleTransferList,
  onClose,
}: SelectedPlayerBarProps) {
  const { t } = useTranslation()
  const contractDate = model.contractEnd ? model.contractEnd.slice(0, 10) : null

  return (
    <section
      data-slot="selected-player-bar"
      aria-label={t("onAir.squad.selectedAria", { defaultValue: "Selected player" })}
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border-s-[0.1875rem] border-s-club bg-card py-3 pe-3 ps-4 text-card-foreground"
    >
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <TagBlock tone="club" size="sm">
            {t("onAir.tags.selected", { defaultValue: "Selected" })}
          </TagBlock>
          {model.contractRisk === "critical" || model.contractRisk === "warning" ? (
            <TagBlock tone={model.contractRisk === "critical" ? "negative" : "warning"} size="sm">
              {model.contractRisk === "critical"
                ? t("onAir.tags.alert", { defaultValue: "Alert" })
                : t("onAir.tags.contract", { defaultValue: "Contract" })}
            </TagBlock>
          ) : null}
        </div>
        <h3 className="truncate font-heading text-section font-semibold" title={model.name}>
          {model.name}
        </h3>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {model.age !== null ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">
                {t("onAir.squad.age", { defaultValue: "Age" })}
              </dt>
              <dd className="font-semibold tabular-nums">{model.age}</dd>
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">
              {t("onAir.squad.contractUntil", { defaultValue: "Contract until" })}
            </dt>
            <dd className="font-semibold tabular-nums">{contractDate ?? "-"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">
              {t("onAir.squad.wageFull", { defaultValue: "Full wage" })}
            </dt>
            <dd className="font-semibold tabular-nums">
              {model.wageLabel}
              {t("onAir.squad.perYear", { defaultValue: "/yr" })}
            </dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="club" size="touch" onClick={() => onOpenProfile(model.id)}>
          {t("onAir.squad.profile", { defaultValue: "Profile" })}
        </Button>
        <Button type="button" variant="outline" size="touch" onClick={() => onRenew(model.id)}>
          {t("onAir.squad.renew", { defaultValue: "Renew" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={() => onToggleTransferList(model.id)}
        >
          {model.transferListed
            ? t("onAir.squad.removeFromTransferList", {
                defaultValue: "Remove from transfer list",
              })
            : t("onAir.squad.transferList", { defaultValue: "List for transfer" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label={t("common.close", { defaultValue: "Close" })}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </section>
  )
}
