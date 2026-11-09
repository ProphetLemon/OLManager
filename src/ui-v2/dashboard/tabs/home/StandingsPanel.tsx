import { Fragment } from "react"
import { useTranslation } from "react-i18next"

import type { StandingsPanelData } from "@/lib/home/standings"
import { ClubShield } from "@/ui-v2/components/ui/club-shield"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"
import { cn } from "@/ui-v2/lib/utils"

export interface StandingsPanelProps {
  data: StandingsPanelData
  onOpenTeams: () => void
}

/** Compact league table for Home: user row emphasised, gap divider when the user sits below the cut. */
export function StandingsPanel({ data, onOpenTeams }: StandingsPanelProps) {
  const { t } = useTranslation()
  const title = t("onAir.home.standingsTitle", { defaultValue: "Standings" })
  const won = t("common.won", { defaultValue: "W" })
  const lost = t("common.lost", { defaultValue: "L" })
  const subtitle = [data.competitionName, data.season != null ? String(data.season) : null]
    .filter(Boolean)
    .join(" ")

  return (
    <section
      data-slot="standings-panel"
      aria-label={title}
      className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-line bg-card p-4 text-card-foreground"
    >
      <header className="flex items-center gap-3">
        <span
          data-slot="standings-league-tag"
          title={data.competitionName}
          className="inline-flex min-h-8 max-w-24 shrink-0 items-center rounded-md bg-club px-2 font-heading text-base font-bold uppercase text-club-foreground"
        >
          <span className="truncate">{data.competitionShortName}</span>
        </span>
        <h2 className="min-w-0 flex-1 truncate font-heading text-section font-bold uppercase leading-tight tracking-wide">
          {title}
        </h2>
        {data.season != null ? (
          <span
            data-slot="standings-season"
            className="shrink-0 rounded-full bg-secondary px-3 py-1 font-heading text-sm font-bold tabular-nums text-foreground"
          >
            {t("onAir.home.seasonChip", { season: data.season, defaultValue: "S{{season}}" })}
          </span>
        ) : null}
      </header>
      {data.preseason ? (
        <p data-slot="standings-preseason" className="-mt-1 text-sm text-dim">
          {t("onAir.home.standingsPreseason", { defaultValue: "Season not started" })}
        </p>
      ) : null}

      <div data-slot="standings-scroll" className="min-h-0 flex-1 overflow-y-auto scrollbar-v2">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{`${title}: ${subtitle}`}</caption>
        <colgroup>
          <col className="w-8" />
          <col />
          <col className="w-14" />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-start text-xs text-muted-foreground">
            <th scope="col" className="w-8 py-1.5 pe-2 text-end font-medium">
              <span aria-hidden="true">#</span>
              <span className="sr-only">{t("onAir.home.position", { defaultValue: "Position" })}</span>
            </th>
            <th scope="col" className="py-1.5 text-start font-medium">
              {t("common.team", { defaultValue: "Team" })}
            </th>
            <th scope="col" className="py-1.5 ps-2 text-end font-medium">
              {`${won}-${lost}`}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <Fragment key={row.teamId}>
              {data.gapBefore === index ? (
                <tr data-slot="standings-gap">
                  <td colSpan={3} className="h-5 py-0">
                    <span className="sr-only">
                      {t("onAir.home.standingsGap", { defaultValue: "Gap in the table" })}
                    </span>
                    <span aria-hidden="true" className="block border-t border-dashed border-line" />
                  </td>
                </tr>
              ) : null}
              <tr
                aria-current={row.isMe ? "true" : undefined}
                data-me={row.isMe ? "true" : undefined}
                className={cn(
                  "h-8 border-b border-line/60 last:border-b-0",
                  row.isMe && "bg-club-wash font-bold shadow-[inset_0.1875rem_0_0_var(--club-text)]"
                )}
              >
                <td className="w-8 pe-2 text-end tabular-nums">{row.position}</td>
                <td className="min-w-0 py-1">
                  <button
                    type="button"
                    onClick={onOpenTeams}
                    title={row.name}
                    className="flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md text-start hover:underline"
                  >
                    <ClubShield name={row.name} logoUrl={row.logoUrl} size="sm" />
                    <span data-slot="standings-short" className="w-10 shrink-0 font-heading text-base font-semibold uppercase leading-none tracking-wide">{row.shortName}</span>
                    <span data-slot="standings-name" className="min-w-0 flex-1 truncate text-xs font-normal text-foreground">
                      {row.name}
                    </span>
                    {row.isMe ? (
                      <TagBlock tone="club" size="sm" className="shrink-0">
                        {t("onAir.tags.you", { defaultValue: "You" })}
                      </TagBlock>
                    ) : null}
                    {row.movement === "promoted" ? (
                      <TagBlock tone="positive" size="sm" className="shrink-0">
                        {t("onAir.tags.promoted", { defaultValue: "Promoted" })}
                      </TagBlock>
                    ) : null}
                  </button>
                </td>
                <td className="ps-2 text-end tabular-nums">{`${row.won}-${row.lost}`}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  )
}
