import { Menu } from "@base-ui/react/menu"
import { Loader2, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { LolRole } from "@/lib/home/scoreboard"
import { shortRoleKey } from "@/lib/squad/cards"
import { buttonVariants } from "@/ui-v2/components/ui/button"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"
import { cn } from "@/ui-v2/lib/utils"

import { ROLE_DEFAULT, type SwapCandidate } from "./PlayerCardV2"

interface EmptySlotCardProps {
  slotRole: LolRole
  candidates: SwapCandidate[]
  onFill: (playerId: string) => void
  saving?: boolean
}

/** A starting-five slot with nobody in it: same footprint as a player card, one action. */
export function EmptySlotCard({ slotRole, candidates, onFill, saving = false }: EmptySlotCardProps) {
  const { t } = useTranslation()
  const roleLabel = t(shortRoleKey(slotRole), { defaultValue: ROLE_DEFAULT[slotRole] })
  const fillLabel = t("onAir.squad.fillSlot", {
    role: roleLabel,
    defaultValue: `Fill ${roleLabel} slot`,
  })

  return (
    <div
      data-slot="empty-slot-card"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed border-line bg-card/60 p-3"
    >
      <TagBlock tone="secondary" size="sm" className="self-start">
        {roleLabel}
      </TagBlock>
      <p className="flex-1 text-sm text-muted-foreground">
        {t("onAir.squad.slotEmpty", { defaultValue: "No player in this slot" })}
      </p>
      <Menu.Root>
        <Menu.Trigger
          aria-label={fillLabel}
          aria-busy={saving || undefined}
          disabled={saving || candidates.length === 0}
          className={cn(buttonVariants({ variant: "club", size: "touch" }), "gap-2 self-stretch")}
        >
          {saving ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          {t("onAir.squad.fill", { defaultValue: "Fill slot" })}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4} className="z-50">
            <Menu.Popup
              aria-label={fillLabel}
              className="max-h-72 min-w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
            >
              {candidates.map((candidate) => (
                <Menu.Item
                  key={candidate.id}
                  disabled={candidate.disabled}
                  onClick={() => onFill(candidate.id)}
                  className="flex min-h-[var(--hit)] cursor-default flex-col justify-center rounded-md px-3 py-1 text-sm outline-none data-[disabled]:opacity-70 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
                >
                  <span className="font-semibold">{candidate.label}</span>
                  {candidate.disabled && candidate.reason ? (
                    <span className="text-xs text-muted-foreground">{candidate.reason}</span>
                  ) : null}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
