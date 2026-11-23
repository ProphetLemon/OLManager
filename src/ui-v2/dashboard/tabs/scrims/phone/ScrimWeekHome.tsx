import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FileText, Lock, Minus, Play, Target, X } from "lucide-react";

import type { PhoneBlock, PhoneHero, PhoneHome } from "@/lib/scrims/phoneHome";
import type { PhoneRowId, PhoneTag } from "@/lib/scrims/phoneWeek";
import { SCRIM_FOCUS_OBJECTIVE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import { teamIdentity, teamIdentityById, type TeamIdentity } from "@/lib/teams/teamIdentity";
import type { TeamData } from "@/store/gameStore";
import { cn } from "@/ui-v2/lib/utils";
import { RiskMarker } from "../RiskMarker";
import { ResultBadge } from "./ResultBadge";
import { EmptyShield, TeamShield } from "./TeamShield";

export interface ScrimWeekHomeProps {
  home: PhoneHome;
  myTeam: TeamData;
  teams: readonly TeamData[];
  /** Mon..Sun, already translated. */
  weekdayLabels: readonly string[];
  teamNameById: ReadonlyMap<string, string>;
  /** What today asks of the manager, worded for the state of the day (the hero's sentence on a scrim day). */
  todayMessage: string;
  /** The lock sentence; shown on Semana only in the two hero states that carry it. */
  lockText: string | null;
  /** `control` names the button that asked, so the layout can give it focus again when the view closes. */
  onOpen: (id: PhoneRowId, control: string) => void;
}

const WORD_KEY: Record<PhoneTag, string> = {
  next: "scrims.phone.tagNext",
  today: "scrims.phone.tagToday",
  decide: "scrims.phone.tagDecide",
};
const PLAN_LABEL_KEYS = ["training.scrims.planA", "training.scrims.planB", "training.scrims.planC"] as const;
const PLAN_LETTERS = ["A", "B", "C"] as const;

const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** The hero's or a block's word: an icon and the word, never colour alone. */
function Word({ tag, className }: { tag: PhoneTag; className?: string }) {
  const { t } = useTranslation();
  return (
    <span data-slot="phone-week-word" className={cn("flex items-center gap-1.5 font-heading text-entry font-semibold leading-4 text-club-text", className)}>
      <Play aria-hidden="true" className="size-3 shrink-0 fill-current" />
      {t(WORD_KEY[tag])}
    </span>
  );
}

function LockMark() {
  const { t } = useTranslation();
  return (
    <span data-slot="phone-week-lock" className="flex items-center gap-1.5 text-entry leading-4 text-muted-foreground">
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      {t("scrims.slotStatus.locked")}
    </span>
  );
}

/** The two shields of a matchup (yours, then the rival's or an empty one) with their names under them. */
function Matchup({ mine, rival, rivalLabel, compact }: { mine: TeamIdentity; rival: TeamIdentity | null; rivalLabel: string; compact?: boolean }) {
  const size = compact ? "small" : "medium";
  const { t } = useTranslation();
  return (
    <span data-slot="phone-week-matchup" className="flex items-start gap-3">
      <span className="flex w-24 flex-col items-center gap-0.5">
        <TeamShield identity={mine} size={size} />
        <span aria-hidden="true" className="max-w-full truncate font-heading text-entry font-semibold leading-4">{mine.name}</span>
      </span>
      <span aria-hidden="true" className="font-heading text-section font-bold leading-none text-muted-foreground">{t("common.vs")}</span>
      <span className="flex w-32 flex-col items-center gap-0.5">
        {rival ? <TeamShield identity={rival} size={size} /> : <EmptyShield size={size} />}
        <span aria-hidden={rival ? true : undefined} className="max-w-full truncate font-heading text-entry font-semibold leading-4">{rivalLabel}</span>
      </span>
    </span>
  );
}

/** Plans B and C (or A to C) as small shields with their letter, as the Week and WeekDay frames draw them. */
function PlanShields({ plans, from, identityOf, withWords, phrasing }: { plans: readonly (string | null)[]; from: number; identityOf: (id: string) => TeamIdentity; withWords?: boolean; phrasing?: boolean }) {
  const { t } = useTranslation();
  // Inside a button only phrasing content is valid: spans, and the plans' names read through the shields.
  const List = phrasing ? "span" : "ul";
  const Item = phrasing ? "span" : "li";
  return (
    <List data-slot="phone-week-plans" aria-label={phrasing ? undefined : t("scrims.opponentPlans")} className="m-0 flex list-none items-start gap-3 p-0">
      {plans.slice(from).map((id, offset) => {
        const index = from + offset;
        return (
          <Item key={PLAN_LETTERS[index]} className="flex flex-col items-center gap-0.5">
            <span className="relative">
              {id ? <TeamShield identity={identityOf(id)} size="tiny" /> : <EmptyShield size="tiny" />}
              <span aria-hidden="true" className="absolute -end-2 -top-1 inline-flex size-4 items-center justify-center rounded-full bg-muted font-heading text-caption font-bold leading-none">
                {PLAN_LETTERS[index]}
              </span>
            </span>
            <span className={withWords ? "font-heading text-caption leading-3 text-muted-foreground" : "sr-only"}>{t(PLAN_LABEL_KEYS[index])}</span>
          </Item>
        );
      })}
    </List>
  );
}

interface HeroContext {
  slotLabel: (slotIndex: number) => string;
  identityOf: (id: string | null) => TeamIdentity | null;
  mine: TeamIdentity;
  lockText: string | null;
  todayMessage: string;
}

function SlotTitle({ label, word, locked }: { label: string; word: PhoneTag; locked: boolean }) {
  return (
    <span className="flex w-24 shrink-0 flex-col gap-0.5">
      <span className="truncate font-heading text-title font-bold uppercase leading-[1.1]">{label}</span>
      <Word tag={word} />
      {locked ? <LockMark /> : null}
    </span>
  );
}

function HeroBody({ hero, ctx, onOpen, compact }: { hero: PhoneHero; ctx: HeroContext; onOpen: ScrimWeekHomeProps["onOpen"]; compact: boolean }) {
  const { t } = useTranslation();
  const { identityOf, mine, slotLabel } = ctx;
  switch (hero.state) {
    case "decide": {
      const rival = identityOf(hero.opponentTeamId);
      return (
        <div className="flex h-full items-center justify-between gap-3">
          <SlotTitle label={slotLabel(hero.slotIndex)} word="decide" locked={hero.locked} />
          <Matchup mine={mine} rival={rival} rivalLabel={rival?.name ?? t("scrims.noOpponentSet")} />
          {hero.result ? (
            <div data-slot="phone-week-outcome" className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2 font-heading text-section font-bold leading-none">
                <ResultBadge result={hero.result} silent />
                {t(hero.result === "won" ? "scrims.reviewWin" : "scrims.reviewLoss")}
              </span>
              {hero.quality != null ? <span className="text-entry tabular-nums text-muted-foreground">Q{hero.quality}</span> : null}
            </div>
          ) : null}
          {hero.opens ? (
            <button
              type="button"
              data-home-control="hero"
              onClick={() => onOpen(hero.opens as PhoneRowId, "hero")}
              className={cn("ms-auto flex h-[var(--hit)] shrink-0 items-center gap-1 rounded-lg border-2 border-club px-4 font-heading text-section font-bold uppercase leading-none text-club-text", FOCUS_RING)}
            >
              {t("scrims.phone.tagDecide")}
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          ) : null}
        </div>
      );
    }
    case "today": {
      const rival = identityOf(hero.opponentTeamId);
      return (
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-center justify-between gap-3">
            <SlotTitle label={slotLabel(hero.slotIndex)} word="today" locked={false} />
            <div className="flex min-w-0 items-center gap-2">
              <TeamShield identity={mine} size="small" />
              <span aria-hidden="true" className="font-heading text-section font-bold leading-none text-muted-foreground">{t("common.vs")}</span>
              {rival ? <TeamShield identity={rival} size="small" /> : <EmptyShield size="small" />}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-caption leading-3.5 text-muted-foreground">{t("scrims.todayOpponent")}</span>
                <span className="truncate font-heading text-entry font-bold leading-5">{rival?.name ?? t("scrims.noOpponentSet")}</span>
              </div>
            </div>
            {hero.risk ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-caption leading-3.5 text-muted-foreground">{t("scrims.todayRisk")}</span>
                <span className="font-heading text-entry font-semibold"><RiskMarker level={hero.risk} /></span>
              </div>
            ) : null}
            <PlanShields plans={hero.plan} from={0} identityOf={(id) => identityOf(id) ?? { name: id, tag: id, logoUrl: null }} />
          </div>
          <div className="flex items-end justify-between gap-3">
            <p className="m-0 line-clamp-2 min-w-0 flex-1 text-caption leading-3.5">{ctx.todayMessage}</p>
            {hero.locked ? <LockMark /> : null}
          </div>
        </div>
      );
    }
    case "careerStartLate":
      return (
        <p className="m-0 flex h-full items-center gap-3 text-entry leading-5">
          <Lock aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />
          {ctx.lockText ?? t("scrims.slotStatus.locked")}
        </p>
      );
    case "nextObjective":
      return (
        <span className="flex h-full items-center gap-4">
          <Target aria-hidden="true" className="size-9 shrink-0 text-club-text" />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-3">
              <span className="font-heading text-section font-bold leading-none">{t("training.scrims.weeklyObjective")}</span>
              <Word tag="next" />
            </span>
            <span className="line-clamp-2 text-caption leading-3.5 text-muted-foreground">{t("training.scrims.weeklyObjectiveDescription")}</span>
          </span>
          <ChevronRight aria-hidden="true" className="ms-auto size-5 shrink-0 text-muted-foreground" />
        </span>
      );
    case "nextSlot":
      return (
        <span className="flex h-full items-center justify-between gap-3">
          <SlotTitle label={slotLabel(hero.slotIndex)} word="next" locked={hero.locked} />
          <Matchup mine={mine} rival={null} rivalLabel={t("scrims.notPlanned")} compact={compact} />
          <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        </span>
      );
    case "upNext": {
      const rival = identityOf(hero.opponentTeamId);
      return (
        <span className="flex h-full items-center justify-between gap-3">
          <SlotTitle label={slotLabel(hero.slotIndex)} word="next" locked={hero.locked} />
          <Matchup mine={mine} rival={rival} rivalLabel={rival?.name ?? t("scrims.notPlanned")} compact={compact} />
          {rival ? <PlanShields phrasing plans={hero.plan} from={1} identityOf={(id) => identityOf(id) ?? { name: id, tag: id, logoUrl: null }} withWords /> : null}
          {hero.opens ? <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /> : null}
        </span>
      );
    }
    case "report":
      return (
        <span className="flex h-full items-center gap-4">
          <FileText aria-hidden="true" className="size-9 shrink-0 text-muted-foreground" />
          <span className="font-heading text-scoreboard leading-none tabular-nums">{hero.wins}-{hero.losses}</span>
          <span className="text-entry text-muted-foreground">{t("scrims.weekRecord")}</span>
          <ChevronRight aria-hidden="true" className="ms-auto size-5 shrink-0 text-muted-foreground" />
        </span>
      );
  }
}

const HERO_CLASS = "flex min-h-[5.625rem] w-full flex-1 flex-col justify-center overflow-hidden rounded-xl bg-card px-4 py-1.5 text-start text-card-foreground";

function Hero({ hero, ctx, onOpen }: { hero: PhoneHero; ctx: HeroContext; onOpen: ScrimWeekHomeProps["onOpen"] }) {
  const { t } = useTranslation();
  const closed = hero.closedDayKey && hero.state !== "today" ? t(hero.closedDayKey) : null;
  const body = (
    <span className="flex flex-col">
      <HeroBody hero={hero} ctx={ctx} onOpen={onOpen} compact={closed != null} />
      {closed ? <span data-slot="phone-week-closed" className="block truncate text-caption leading-3.5 text-muted-foreground">{closed}</span> : null}
    </span>
  );
  const common = { "data-slot": "phone-week-hero", "data-state": hero.state } as const;

  // The Decide hero is a card with one button of its own; the others are one button when they open something.
  if (hero.state === "decide") {
    return (
      <section {...common} className={HERO_CLASS} aria-label={ctx.slotLabel(hero.slotIndex)}>
        {body}
      </section>
    );
  }
  if (hero.opens) {
    const opens = hero.opens;
    return (
      <button type="button" {...common} data-home-control="hero" onClick={() => onOpen(opens, "hero")} className={cn(HERO_CLASS, FOCUS_RING)}>
        {body}
      </button>
    );
  }
  return (
    <section {...common} className={HERO_CLASS}>
      {body}
    </section>
  );
}

function BlockStateLine({ block }: { block: PhoneBlock }) {
  const { t } = useTranslation();
  if (block.heroWord) return <Word tag={block.heroWord} />;
  switch (block.state) {
    case "played":
      return (
        <span className="flex items-center gap-1.5 leading-[0.875rem]">
          {block.result ? <ResultBadge result={block.result} /> : null}
          {block.quality != null ? <span className="text-caption tabular-nums">Q{block.quality}</span> : null}
        </span>
      );
    case "cancelled":
    case "notPlayed": {
      const Icon = block.state === "cancelled" ? X : Minus;
      return (
        <span className="flex items-center gap-1 font-heading text-entry font-semibold leading-[0.875rem] text-muted-foreground">
          <Icon aria-hidden="true" className="size-3 shrink-0" strokeWidth={3} />
          {t(block.state === "cancelled" ? "scrims.slotStatus.cancelled" : "scrims.slotStatus.notPlayed")}
        </span>
      );
    }
    default:
      return null;
  }
}

function Block({ block, identityOf, nameOf, weekdayLabel, onOpen }: {
  block: PhoneBlock;
  identityOf: (id: string) => TeamIdentity;
  nameOf: (id: string) => string;
  weekdayLabel: string;
  onOpen: ScrimWeekHomeProps["onOpen"];
}) {
  const { t } = useTranslation();
  const rival = block.rival.kind === "team" ? identityOf(block.rival.teamId) : null;
  const dim = block.state === "cancelled" || block.state === "notPlayed";
  const emptyText = block.rival.kind === "cleared" ? t("scrims.planCleared") : t("scrims.notPlanned");
  const className = cn(
    "flex h-[var(--hit)] w-full min-w-0 items-center gap-1.5 rounded-[10px] border-2 px-1 text-start",
    block.isHero ? "border-club" : "border-transparent",
    block.opens && FOCUS_RING,
  );
  const content = (
    <>
      <span className={cn("w-4 shrink-0 font-heading text-section font-bold leading-none", block.isHero ? "text-foreground" : "text-muted-foreground")}>
        {block.suffix}
      </span>
      {rival ? <TeamShield identity={rival} size="small" /> : <EmptyShield size="small" />}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span aria-hidden={rival ? true : undefined} className={cn("truncate font-heading text-entry font-semibold leading-4", dim && "text-muted-foreground")}>
          {rival ? nameOf(block.rival.kind === "team" ? block.rival.teamId : "") : emptyText}
        </span>
        <BlockStateLine block={block} />
      </span>
    </>
  );
  const common = { "data-slot": "phone-week-block", "data-state": block.state, "data-hero": block.isHero ? "true" : "false", "data-slot-index": block.slotIndex } as const;
  if (!block.opens) {
    return (
      <div {...common} className={className} role="group" aria-label={`${weekdayLabel} ${block.suffix}`.trim()}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" {...common} data-home-control={`block:${block.id}`} className={className} onClick={() => onOpen(block.id, `block:${block.id}`)}>
      {content}
    </button>
  );
}

function Entry({ control, label, onOpen, id, children }: { control: string; label: string; id: PhoneRowId; onOpen: ScrimWeekHomeProps["onOpen"]; children: ReactNode }) {
  return (
    <button
      type="button"
      data-slot="phone-week-entry"
      data-home-control={control}
      aria-label={label}
      onClick={() => onOpen(id, control)}
      className={cn("flex h-[var(--hit)] min-w-0 items-center gap-2.5 rounded-lg ps-0.5 pe-1 text-start", FOCUS_RING)}
    >
      {children}
      <ChevronRight aria-hidden="true" className="size-[1.125rem] shrink-0 text-muted-foreground" />
    </button>
  );
}

/**
 * Semana: the home of the Scrims tab on a phone. Three entries (Objective, Volume, Report), the hero
 * (what needs the manager, one of seven states) and the week's blocks by day with each rival's real
 * logo. It computes nothing: `buildPhoneHome` does, and a tap only says what it wants opened.
 */
export function ScrimWeekHome({ home, myTeam, teams, weekdayLabels, teamNameById, todayMessage, lockText, onOpen }: ScrimWeekHomeProps) {
  const { t } = useTranslation();
  const { objective, volume, report } = home.entries;
  const nameOf = (id: string) => teamNameById.get(id) ?? id;
  const identityOf = (id: string | null): TeamIdentity | null =>
    id ? (teamIdentityById(teams, id) ?? { name: nameOf(id), tag: id, logoUrl: null }) : null;
  const identityOfId = (id: string): TeamIdentity => identityOf(id) as TeamIdentity;
  const blocksFlat = home.days.flatMap((day) => day.blocks.map((block) => ({ block, weekday: day.weekday })));
  const slotLabel = (slotIndex: number) => {
    const found = blocksFlat.find((entry) => entry.block.slotIndex === slotIndex);
    return found ? `${weekdayLabels[found.weekday] ?? ""} ${found.block.suffix}`.trim() : "";
  };

  const objectiveLabel = objective.objective ? t(SCRIM_FOCUS_OBJECTIVE_KEYS[objective.objective]) : t("training.scrims.objectives.none");
  const days = volume.days.map((day) => weekdayLabels[day] ?? "");
  const record = `${report.wins}-${report.losses}`;
  const reportText = report.hasResult ? record : t("scrims.noRecentReports");

  return (
    <div data-slot="scrim-week-home" className="scrollbar-v2 flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-3 pt-1">
      <div data-slot="phone-week-entries" className="flex h-[var(--hit)] shrink-0 items-center gap-5 border-b border-line">
        <Entry control="objective" id="objective" onOpen={onOpen} label={`${t("scrims.weeklyObjective")}: ${objectiveLabel}`}>
          <Target aria-hidden="true" className="size-6 shrink-0 text-club-text" />
          <span className="truncate text-entry font-medium">{objectiveLabel}</span>
        </Entry>
        <Entry control="volume" id="volume" onOpen={onOpen} label={`${t("scrims.weeklyVolume")}: ${[volume.capacity, ...days].join(", ")}`}>
          <span className="font-heading text-title font-bold leading-none tabular-nums">{volume.capacity}</span>
          <span className="text-caption text-muted-foreground">{days.join(" ")}</span>
        </Entry>
        <Entry control="report" id="report" onOpen={onOpen} label={`${t("scrims.weeklyReportInline")}: ${report.hasResult ? `${record} ${t("scrims.weekRecord")}` : reportText}`}>
          <FileText aria-hidden="true" className="size-[1.375rem] shrink-0 text-muted-foreground" />
          {report.hasResult ? (
            <>
              <span className="font-heading text-title font-bold leading-none tabular-nums">{record}</span>
              <span className="truncate text-caption text-muted-foreground">{t("scrims.weekRecord")}</span>
            </>
          ) : (
            <span className="truncate text-entry text-muted-foreground">{t("scrims.noRecentReports")}</span>
          )}
        </Entry>
      </div>

      <Hero
        hero={home.hero}
        onOpen={onOpen}
        ctx={{ slotLabel, identityOf, mine: teamIdentity(myTeam), lockText, todayMessage }}
      />

      <div role="group" aria-label={t("scrims.phone.weekList")} data-slot="phone-week-days" className="flex h-[7.25rem] shrink-0 gap-6">
        {home.days.map((day) => (
          <div
            key={day.weekday}
            role="group"
            aria-label={weekdayLabels[day.weekday] ?? ""}
            data-slot="phone-week-day"
            className="flex min-w-0 flex-1 flex-col gap-0.5"
          >
            <span aria-hidden="true" className="block h-4 border-b border-line ps-1.5 font-heading text-entry font-bold uppercase leading-4">
              {weekdayLabels[day.weekday] ?? ""}
            </span>
            {day.blocks.map((block) => (
              <Block key={block.id} block={block} identityOf={identityOfId} nameOf={nameOf} weekdayLabel={weekdayLabels[day.weekday] ?? ""} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
