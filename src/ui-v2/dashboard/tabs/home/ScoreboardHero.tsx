import { useId, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Users } from "lucide-react";

import type { ScoreboardData, SideData } from "@/lib/home/scoreboard";
import { formatMatchDate } from "@/lib/formatting/dateFormatting";
import { Button } from "@/ui-v2/components/ui/button";
import { Card, CardContent } from "@/ui-v2/components/ui/card";
import { ClubShield } from "@/ui-v2/components/ui/club-shield";
import { ScoreNumeral } from "@/ui-v2/components/ui/score-numeral";
import { TagBlock, type TagTone } from "@/ui-v2/components/ui/tag-block";
import { cn } from "@/ui-v2/lib/utils";

interface ScoreboardHeroProps {
  /** `null` when the club has no fixture left to play. */
  data: ScoreboardData | null;
  onOpenSchedule: () => void;
  onOpenSquad: () => void;
}

/** Short names shrink with length so five to nine characters still fit a side. */
export function shortNameSizeClass(shortName: string): string {
  const length = Array.from(shortName.trim()).length;
  if (length <= 3) return "text-[3.75rem] @2xl:text-scoreboard";
  if (length === 4) return "text-[3.25rem] @2xl:text-[4.5rem]";
  if (length <= 6) return "text-[2.5rem] @2xl:text-[3.5rem]";
  return "text-[2rem] @2xl:text-[2.5rem]";
}

const FORM_TONE: Record<"W" | "L" | "D", { tone: TagTone; key: string; fallback: string }> = {
  W: { tone: "positive", key: "onAir.home.formWin", fallback: "Win" },
  L: { tone: "negative", key: "onAir.home.formLoss", fallback: "Loss" },
  D: { tone: "neutral", key: "onAir.home.formDraw", fallback: "Draw" },
};

/** The count is rendered as a numeral, so keep only the words of "N days to go". */
function captionWithoutCount(label: string, count: number): string {
  const stripped = label.replace(String(count), "").replace(/\s{2,}/g, " ").trim();
  return stripped || label;
}

const ROLE_ORDER = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;

/**
 * Condensed name plates with a 3px club (or opponent) edge. The role is the centre
 * column on wide containers; narrow containers show it inside the plate instead.
 */
function SidePlates({ side, mirrored, label }: { side: SideData; mirrored: boolean; label: string }) {
  const { t } = useTranslation();
  return (
    <ul aria-label={label} className="flex min-w-0 flex-col gap-1">
      {side.lineup.map((plate) => {
        const empty = !plate.playerId;
        const roleLabel = t(`onAir.roles.${plate.role}`, { defaultValue: plate.role });
        return (
          <li
            key={plate.role}
            data-slot="lineup-plate"
            data-role={plate.role}
            data-empty={empty ? "true" : undefined}
            className={cn(
              "flex h-8 min-w-0 items-center gap-2 bg-background/40",
              mirrored
                ? "flex-row-reverse border-e-[3px] pe-2 ps-1 text-end border-e-[color:var(--side-accent)]"
                : "border-s-[3px] border-s-club ps-2 pe-1"
            )}
          >
            <span className="w-14 shrink-0 text-xs font-bold text-foreground @lg:sr-only">{roleLabel}</span>
            {empty ? (
              <>
                <span aria-hidden="true" className="min-w-0 flex-1 font-heading text-xl font-semibold leading-none text-foreground">
                  {"—"}
                </span>
                <span className="sr-only">{t("onAir.home.notSet", { defaultValue: "Not set" })}</span>
              </>
            ) : (
              <>
                <span title={plate.name} className="min-w-0 flex-1 truncate font-heading text-xl font-semibold leading-none">
                  {plate.name}
                </span>
                {plate.ovr !== null ? (
                  <span className="shrink-0 font-heading text-sm font-bold tabular-nums text-foreground">
                    {plate.ovr}
                  </span>
                ) : null}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One centred role label per row, shared by both lineups (decorative: plates carry the role for assistive tech). */
function RoleColumn() {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden="true"
      data-slot="role-column"
      className="hidden min-w-16 flex-col gap-1 text-center @lg:flex"
    >
      {ROLE_ORDER.map((role) => (
        <span key={role} className="flex h-8 items-center justify-center text-sm font-semibold text-foreground">
          {t(`onAir.roles.${role}`, { defaultValue: role })}
        </span>
      ))}
    </div>
  );
}

function SideHeader({ side, mirrored, caption }: { side: SideData; mirrored: boolean; caption: string }) {
  const accent = mirrored ? "var(--side-accent)" : undefined;
  const foreground = mirrored ? "var(--side-foreground)" : undefined;
  return (
    <div
      data-slot="side-header"
      data-side={mirrored ? "opponent" : "you"}
      className={cn("flex min-w-0 items-center gap-3", mirrored && "flex-row-reverse text-end")}
    >
      <ClubShield
        name={side.name}
        logoUrl={side.logoUrl}
        size="lg"
        accent={accent}
        foreground={foreground}
        className="@2xl:size-20"
      />
      <div className="min-w-0">
        <span title={side.name} className="block max-w-full overflow-hidden">
          <ScoreNumeral value={side.shortName} size="scoreboard" className={shortNameSizeClass(side.shortName)} />
        </span>
        <p title={side.name} className="truncate text-sm text-foreground">
          {side.name}
          {caption ? `, ${caption}` : ""}
        </p>
      </div>
    </div>
  );
}

function OpponentForm({ opponent }: { opponent: SideData }) {
  const { t } = useTranslation();
  const label = t("home.nextMatchCard.opponentForm", { defaultValue: "Opponent form" });
  if (opponent.form.length === 0) {
    return (
      <p data-slot="opponent-form" className="min-w-0 text-sm text-foreground">
        {t("onAir.home.formAfterFirst", {
          team: opponent.name,
          defaultValue: "{{team}}'s form appears after their first match",
        })}
      </p>
    );
  }
  return (
    <div data-slot="opponent-form" className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="text-sm font-semibold text-foreground">
        {t("onAir.home.formLabel", { defaultValue: "Form" })}
      </span>
      <ul aria-label={label} className="flex items-center gap-1.5">
        {opponent.form.map((result, index) => {
          const entry = FORM_TONE[result];
          return (
            <li key={`${index}-${result}`}>
              <TagBlock size="sm" tone={entry.tone} slant={false} className="min-w-6">
                <span aria-hidden="true">{result}</span>
                <span className="sr-only">{t(entry.key, { defaultValue: entry.fallback })}</span>
              </TagBlock>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Next-match scoreboard graphic: both sides, countdown, five role plates each. */
export function ScoreboardHero({ data, onOpenSchedule, onOpenSquad }: ScoreboardHeroProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();

  if (!data) {
    return (
      <Card data-slot="scoreboard-hero" data-empty="true" className="h-full">
        <CardContent className="flex h-full items-center justify-center py-10">
          <p className="text-base text-foreground">
            {t("home.nextMatchCard.none", { defaultValue: "No fixtures scheduled" })}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { you, opponent, daysToGo } = data;
  const kindLabel = (() => {
    switch (data.kind) {
      case "Playoffs":
        return t("schedule.playoffs", { defaultValue: "Playoffs" });
      case "PreseasonTournament":
        return t("season.preseasonTournament", { defaultValue: "Preseason Tournament" });
      case "Friendly":
        return t("season.friendly", { defaultValue: "Friendly" });
      default:
        return t("common.matchday", { n: data.matchday, defaultValue: `Matchday ${data.matchday}` });
    }
  })();
  const vsAtWord = data.isHome
    ? t("onAir.home.vsAt.home", { defaultValue: "vs" })
    : t("onAir.home.vsAt.away", { defaultValue: "at" });
  const daysLabel = t("onAir.home.daysToGo", {
    count: daysToGo,
    defaultValue: daysToGo === 1 ? "{{count}} day to go" : "{{count}} days to go",
  });
  const isMatchDay = daysToGo <= 0;
  const sideStyle = {
    "--side-accent": opponent.palette.accent,
    "--side-secondary": opponent.palette.secondary ?? opponent.palette.accent,
    "--side-foreground": opponent.palette.foreground,
  } as CSSProperties;

  return (
    <section
      aria-labelledby={headingId}
      data-slot="scoreboard-hero"
      data-kind={data.kind}
      data-match-day={isMatchDay ? "true" : undefined}
      style={sideStyle}
      className="@container relative isolate overflow-hidden rounded-xl border border-border bg-card"
    >
      {/* Static wedges. In high contrast the wash is dropped and tags carry outlines instead. */}
      <div
        aria-hidden="true"
        data-slot="wedge-you"
        className="pointer-events-none absolute inset-y-0 start-0 -z-10 w-[58%] bg-club-wash [clip-path:polygon(0_0,100%_0,62%_100%,0_100%)] [[data-contrast=high]_&]:hidden"
      />
      <div
        aria-hidden="true"
        data-slot="wedge-opponent"
        className="pointer-events-none absolute inset-y-0 end-0 -z-10 w-[58%] bg-[color-mix(in_srgb,var(--side-accent)_36%,transparent)] [clip-path:polygon(38%_0,100%_0,100%_100%,0_100%)] [[data-contrast=high]_&]:hidden"
      />

      <div className="flex flex-col gap-4 p-5">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={headingId} className="font-heading text-section font-bold">
            {t("home.nextMatchCard.title", { defaultValue: "Next Match" })}
          </h2>
          <TagBlock size="sm">{data.competitionName}</TagBlock>
          <TagBlock size="sm" tone={data.kind === "Playoffs" ? "warning" : "secondary"}>
            {kindLabel}
          </TagBlock>
          {data.kind === "Playoffs" && data.bestOf ? (
            <TagBlock size="sm" tone="warning">
              {t("onAir.home.bestOf", { count: data.bestOf, defaultValue: "Best of {{count}}" })}
            </TagBlock>
          ) : null}
          <TagBlock size="sm" tone="info">
            {`${vsAtWord} ${opponent.shortName}`}
          </TagBlock>
          <time dateTime={data.date.slice(0, 10)} className="ms-auto text-sm font-semibold text-foreground">
            {formatMatchDate(data.date, i18n.language)}
          </time>
        </header>

        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 @lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <SideHeader side={you} mirrored={false} caption={t("onAir.home.yourClub", { defaultValue: "Your club" })} />
          <div data-slot="countdown" className="flex flex-col items-center self-center px-1 text-center">
            {isMatchDay ? (
              <TagBlock size="lg" tone="club">
                {t("onAir.home.matchDay", { defaultValue: "Match day" })}
              </TagBlock>
            ) : (
              <>
                <span className="sr-only">{daysLabel}</span>
                <span aria-hidden="true" className="flex flex-col items-center gap-1">
                  <ScoreNumeral value={daysToGo} size="ovr" className="text-[5rem]" />
                  <span className="text-sm text-foreground">{captionWithoutCount(daysLabel, daysToGo)}</span>
                </span>
              </>
            )}
          </div>
          <SideHeader side={opponent} mirrored caption="" />

          <SidePlates
            side={you}
            mirrored={false}
            label={`${you.name}: ${t("onAir.home.startingFive", { defaultValue: "Starting five" })}`}
          />
          <RoleColumn />
          <SidePlates
            side={opponent}
            mirrored
            label={`${opponent.name}: ${t("onAir.home.startingFive", { defaultValue: "Starting five" })}`}
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3">
          <OpponentForm opponent={opponent} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="touch" className="text-club-text" onClick={onOpenSquad}>
              <Users aria-hidden="true" />
              {t("dashboard.squad", { defaultValue: "Squad" })}
            </Button>
            <Button type="button" variant="outline" size="touch" onClick={onOpenSchedule}>
              <CalendarDays aria-hidden="true" />
              {t("onAir.home.openSchedule", { defaultValue: "Open schedule" })}
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );
}
