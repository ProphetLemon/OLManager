import { X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { shortRoleKey, type PlayerCardModel } from "@/lib/squad/cards"
import { Button } from "@/ui-v2/components/ui/button"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"

import { ROLE_DEFAULT } from "./PlayerCardV2"

interface SelectedPlayerBarProps {
  model: PlayerCardModel
  onOpenProfile: (id: string) => void
  onRenew: (id: string) => void
  onToggleTransferList: (id: string) => void
  onClose: () => void
}

function Chip({ children }: { children: string }) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-border bg-muted px-2.5 text-xs font-semibold text-foreground">
      {children}
    </span>
  )
}

/** One fact: value above, label below. The label comes first in the DOM for the dl semantics. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

export function SelectedPlayerBar({
  model,
  onOpenProfile,
  onRenew,
  onToggleTransferList,
  onClose,
}: SelectedPlayerBarProps) {
  const { t } = useTranslation()
  const roleLabel = t(shortRoleKey(model.role), { defaultValue: ROLE_DEFAULT[model.role] })

  return (
    <section
      data-slot="selected-player-bar"
      aria-label={t("onAir.squad.selectedAria", { defaultValue: "Selected player" })}
      className="flex flex-wrap items-stretch gap-y-3 overflow-hidden rounded-xl border border-line bg-card text-card-foreground"
    >
      {/* Slanted lower-third plate: club fill, so its text uses the club foreground. */}
      <div className="relative z-10 flex items-center bg-club py-3 ps-5 pe-9 font-heading text-section font-bold text-club-foreground [clip-path:polygon(0_0,100%_0,calc(100%-0.875rem)_100%,0_100%)]">
        {t("onAir.tags.selected", { defaultValue: "Selected" })}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ps-3 pe-4">
        <h3
          className="min-w-0 truncate font-heading text-title font-bold uppercase leading-none"
          title={model.name}
        >
          {model.name}
        </h3>
        <Chip>{roleLabel}</Chip>
        {model.nationalityName ? <Chip>{model.nationalityName}</Chip> : null}
        {model.contractRisk === "critical" || model.contractRisk === "warning" ? (
          <TagBlock tone={model.contractRisk === "critical" ? "negative" : "warning"} size="sm">
            {model.contractRisk === "critical"
              ? t("onAir.tags.alert", { defaultValue: "Alert" })
              : t("onAir.tags.contract", { defaultValue: "Contract" })}
          </TagBlock>
        ) : null}
      </div>

      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 border-s border-line px-4 py-2 text-sm">
        {model.age !== null ? (
          <Fact label={t("onAir.squad.age", { defaultValue: "Age" })} value={String(model.age)} />
        ) : null}
        <Fact
          label={t("onAir.squad.contractUntil", { defaultValue: "Contract until" })}
          value={model.contractEndLabel ?? "-"}
        />
        <Fact
          label={t("onAir.squad.wagePerYear", { defaultValue: "Wage per year" })}
          value={model.wageLabel}
        />
      </dl>

      <div className="ms-auto flex flex-wrap items-center gap-2 px-3 py-2">
        <Button type="button" variant="club" size="touch" onClick={() => onOpenProfile(model.id)}>
          {t("onAir.squad.profile", { defaultValue: "Profile" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="touch"
          className="text-club-text"
          onClick={() => onRenew(model.id)}
        >
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
