import { resolveUserLeague } from "@/lib/userLeague";
import type { TFunction } from "i18next";

import { SOCIAL_CONTENT_PACK } from "@/content/lol/social/content";
import { extractMatchContext, type CompatibleMatchSummary } from "@/content/lol/social/matchContext";
import { DEFAULT_LEAGUE_ID, registrySide, type RegistrySide, type UserSide } from "@/content/lol/social/shared";
import {
  filterEligibleOutlets,
  filterEligiblePersonas,
  filterEligibleQuestions,
  filterEligibleResponses,
  selectWeighted,
} from "@/content/lol/social/selectors";
import type { SocialQuestion } from "@/content/lol/social/schema";
import type { GameStateData } from "@/store/gameStore";
import type { MatchEvent, MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import { DraftTeamObjectives } from "@/ui-v2/_legacy/components/match/draftResultSimulator";

export interface PressResponse {
  id: string;
  tone: string;
  text: string;
  effectId: string;
  target: "squad" | "player" | "none";
}

export interface PressQuestion {
  id: string;
  journalist: string;
  outlet: string;
  question: string;
  responses: PressResponse[];
  playerId?: string;
}

interface Candidate {
  question: SocialQuestion;
  personaId: string;
  personaName: string;
  outletName: string;
  weight: number;
}

function isQuestionCoherentWithResult(candidate: Candidate, result: "win" | "loss"): boolean {
  const required = new Set(candidate.question.requiredTags ?? []);
  const id = candidate.question.id.toLowerCase();
  if (result === "win") {
    if (required.has("loss") || required.has("stomped") || required.has("underperformance") || required.has("objective_control")) {
      return false;
    }
    if (id.includes("loss") || id.includes("underperformance") || id.includes("vision-control-loss")) {
      return false;
    }
  }

  if (result === "loss") {
    if (required.has("win") || required.has("stomp") || required.has("objective_domination")) {
      return false;
    }
  }

  return true;
}

interface BuildPressConferenceQuestionsParams {
  snapshot: MatchSnapshot;
  gameState: GameStateData;
  userSide: UserSide;
  t: TFunction | ((key: string) => string);
  random?: () => number;
  recentQuestionIds?: string[];
  /** The user's actual in-game side (blue/red). Defaults to registrySide(userSide). */
  controlledSide?: RegistrySide;
  /** The actual winning side (blue/red). When omitted it is inferred from snapshot scores. */
  winnerSide?: RegistrySide;
  /** Optional explicit result override. Takes precedence over winnerSide inference. */
  userResult?: "win" | "loss";
}

const PRESS_CONFERENCE_QUESTION_TARGET = 3;

function eventRegistrySide(eventSide: MatchEvent["side"], homeIsBlue: boolean): RegistrySide {
  if (eventSide === "Home") return homeIsBlue ? "blue" : "red";
  return homeIsBlue ? "red" : "blue";
}

function countEvents(events: MatchEvent[], side: RegistrySide, names: string[], homeIsBlue: boolean): number {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  return events.filter(
    (event) => eventRegistrySide(event.side, homeIsBlue) === side && normalized.has(event.event_type.toLowerCase()),
  ).length;
}

function deathsFor(events: MatchEvent[], playerId: string): number {
  return events.filter(
    (event) =>
      event.player_id === playerId &&
      ["death", "died", "killed"].includes(event.event_type.toLowerCase()),
  ).length;
}

function eventTypeToTimelineType(eventType: string): string {
  const normalized = eventType.toLowerCase();
  switch (normalized) {
    case "firstblood":
    case "first_blood":
      return "first_blood";
    case "voidgrub":
    case "voidgrubs":
      return "voidgrubs";
    case "dragonsoul":
    case "dragon_soul":
      return "dragon_soul";
    case "elderdragon":
    case "elder":
      return "elder";
    case "baron":
    case "herald":
    case "dragon":
    case "inhibitor":
    case "tower":
      return normalized;
    case "nexusdestroyed":
    case "nexus":
      return "nexus";
    default:
      return normalized;
  }
}

function otherRegistrySide(side: RegistrySide): RegistrySide {
  return side === "blue" ? "red" : "blue";
}

function snapshotToSummary(
  snapshot: MatchSnapshot,
  userSide: UserSide,
  controlledSide?: RegistrySide,
  forcedWinnerSide?: RegistrySide,
): CompatibleMatchSummary {
  const userTeam = userSide === "Home" ? snapshot.home_team : snapshot.away_team;
  const enemyTeam = userSide === "Home" ? snapshot.away_team : snapshot.home_team;
  const userRegistrySide = controlledSide ?? registrySide(userSide);
  const enemyRegistrySide = otherRegistrySide(userRegistrySide);

  // Determine which canonical team is playing blue side. When controlledSide is
  // supplied we can map Home/Away events to the correct blue/red side even if
  // the active snapshot was side-swapped.
  const blueTeamId = userSide === "Home"
    ? (userRegistrySide === "blue" ? snapshot.home_team.id : snapshot.away_team.id)
    : (userRegistrySide === "blue" ? snapshot.away_team.id : snapshot.home_team.id);
  const homeIsBlue = snapshot.home_team.id === blueTeamId;

  const userKills = countEvents(snapshot.events, userRegistrySide, ["Kill", "FirstBlood", "Goal", "PenaltyGoal"], homeIsBlue);
  const enemyKills = countEvents(snapshot.events, enemyRegistrySide, ["Kill", "FirstBlood", "Goal", "PenaltyGoal"], homeIsBlue);

  const userRegistrySideData: DraftTeamObjectives = {
    voidgrubs: countEvents(snapshot.events, userRegistrySide, ["VoidGrub", "VoidGrubs"], homeIsBlue),
    dragons: countEvents(snapshot.events, userRegistrySide, ["Dragon"], homeIsBlue),
    dragonSoul: countEvents(snapshot.events, userRegistrySide, ["DragonSoul"], homeIsBlue) > 0,
    elderDragons: countEvents(snapshot.events, userRegistrySide, ["ElderDragon"], homeIsBlue),
    heralds: countEvents(snapshot.events, userRegistrySide, ["Herald"], homeIsBlue),
    barons: countEvents(snapshot.events, userRegistrySide, ["Baron"], homeIsBlue),
    towers: countEvents(snapshot.events, userRegistrySide, ["Tower"], homeIsBlue),
    inhibitors: countEvents(snapshot.events, userRegistrySide, ["Inhibitor"], homeIsBlue),
  };

  const enemyRegistrySideData: DraftTeamObjectives = {
    voidgrubs: countEvents(snapshot.events, enemyRegistrySide, ["VoidGrub", "VoidGrubs"], homeIsBlue),
    dragons: countEvents(snapshot.events, enemyRegistrySide, ["Dragon"], homeIsBlue),
    dragonSoul: countEvents(snapshot.events, enemyRegistrySide, ["DragonSoul"], homeIsBlue) > 0,
    elderDragons: countEvents(snapshot.events, enemyRegistrySide, ["ElderDragon"], homeIsBlue),
    heralds: countEvents(snapshot.events, enemyRegistrySide, ["Herald"], homeIsBlue),
    barons: countEvents(snapshot.events, enemyRegistrySide, ["Baron"], homeIsBlue),
    towers: countEvents(snapshot.events, enemyRegistrySide, ["Tower"], homeIsBlue),
    inhibitors: countEvents(snapshot.events, enemyRegistrySide, ["Inhibitor"], homeIsBlue),
  };

  const inferredWinnerSide =
    (userSide === "Home" ? snapshot.home_score > snapshot.away_score : snapshot.away_score > snapshot.home_score)
      ? userRegistrySide
      : enemyRegistrySide;

  return {
    winnerSide: forcedWinnerSide ?? inferredWinnerSide,
    blueKills: userRegistrySide === "blue" ? userKills : enemyKills,
    redKills: userRegistrySide === "red" ? userKills : enemyKills,
    objectives: {
      red: userRegistrySide === "red" ? userRegistrySideData : enemyRegistrySideData,
      blue: userRegistrySide === "blue" ? userRegistrySideData : enemyRegistrySideData,
    },
    playerResults: [
      ...userTeam.players.map((player) => {
        const deaths = deathsFor(snapshot.events, player.id);
        return {
          side: userRegistrySide,
          playerId: player.id,
          playerName: player.name,
          role: player.role ?? "",
          deaths,
          rating: deaths > 0 ? 4 : 6,
        };
      }),
      ...enemyTeam.players.map((player) => ({
        side: enemyRegistrySide,
        playerId: player.id,
        playerName: player.name,
        role: player.role ?? "",
        deaths: deathsFor(snapshot.events, player.id),
        rating: 6,
      })),
    ],
    timelineEvents: snapshot.events.map((event) => ({
      minute: event.minute,
      side: eventRegistrySide(event.side, homeIsBlue),
      type: eventTypeToTimelineType(event.event_type),
    })),
  };
}

function buildCandidates(params: {
  questions: SocialQuestion[];
  leagueId?: string;
  contextTags: string[];
  contextFacts: Record<string, string | number | boolean>;
}): Candidate[] {
  const outlets = filterEligibleOutlets(SOCIAL_CONTENT_PACK.outlets, { leagueId: params.leagueId });
  const personas = filterEligiblePersonas(SOCIAL_CONTENT_PACK.personas, {
    leagueId: params.leagueId,
    outletIds: outlets.map((outlet) => outlet.id),
  });

  return personas.flatMap((persona) => {
    const outlet = outlets.find((item) => item.id === persona.outletId);
    if (!outlet) return [];

    const questions = filterEligibleQuestions(params.questions, {
      leagueId: params.leagueId,
      personaId: persona.id,
      allowedTones: persona.allowedTones,
      contextTags: params.contextTags,
      contextFacts: params.contextFacts,
    });

    return questions.map((question) => ({
      question,
      personaId: persona.id,
      personaName: persona.displayName,
      outletName: outlet.name,
      weight: persona.weight * outlet.weight * question.weight,
    }));
  });
}

function selectDiverseQuestions(
  candidates: Candidate[],
  random: () => number,
  targetCount = PRESS_CONFERENCE_QUESTION_TARGET,
): Candidate[] {
  const selected: Candidate[] = [];
  let remaining = candidates.filter((candidate) => candidate.weight > 0);

  while (selected.length < targetCount && remaining.length > 0) {
    const candidate = selectWeighted(remaining, random);
    if (!candidate) break;

    selected.push(candidate);
    remaining = remaining.filter((item) => item.question.id !== candidate.question.id);
  }

  return selected;
}

function selectPressConferenceCandidates(
  candidates: Candidate[],
  random: () => number,
  recentQuestionIds: string[] = [],
): Candidate[] {
  if (recentQuestionIds.length === 0) {
    return selectDiverseQuestions(candidates, random);
  }

  const recentIds = new Set(recentQuestionIds);
  const freshCandidates = candidates.filter((candidate) => !recentIds.has(candidate.question.id));

  if (freshCandidates.length === 0) {
    return selectDiverseQuestions(candidates, random);
  }

  const selected = selectDiverseQuestions(freshCandidates, random);
  if (selected.length >= PRESS_CONFERENCE_QUESTION_TARGET) return selected;

  const selectedIds = new Set(selected.map((candidate) => candidate.question.id));
  const fallbackCandidates = candidates.filter((candidate) => !selectedIds.has(candidate.question.id));

  return [
    ...selected,
    ...selectDiverseQuestions(
      fallbackCandidates,
      random,
      PRESS_CONFERENCE_QUESTION_TARGET - selected.length,
    ),
  ];
}

function buildPressQuestion(params: {
  candidate: Candidate;
  contextFacts: Record<string, string | number | boolean>;
  fallbackResponses: PressResponse[];
  t: TFunction | ((key: string) => string);
}): PressQuestion {
  const responses = filterEligibleResponses(SOCIAL_CONTENT_PACK.responses, {
    responseIds: params.candidate.question.responseIds,
    allowedTones: params.candidate.question.tones,
  })
    .map((response) => ({
      id: response.id,
      tone: params.t(response.labelKey),
      text: params.t(response.textKey),
      effectId: response.effectId,
      target: response.target,
    }))
    .filter((response) => response.text && response.tone);

  const safeResponses = responses.length > 0 ? responses : params.fallbackResponses;

  const targetPlayerId =
    responses.some((response) => response.target === "player") && typeof params.contextFacts.worstPlayerId === "string"
      ? params.contextFacts.worstPlayerId
      : undefined;

  return {
    id: params.candidate.question.id,
    journalist: params.candidate.personaName,
    outlet: params.candidate.outletName,
    question: params.t(params.candidate.question.textKey),
    responses: safeResponses,
    playerId: targetPlayerId,
  };
}

export function buildPressConferenceQuestions({
  snapshot,
  gameState,
  userSide,
  t,
  random = Math.random,
  recentQuestionIds = [],
  controlledSide,
  winnerSide,
  userResult,
}: BuildPressConferenceQuestionsParams): PressQuestion[] {
  const leagueId = resolveUserLeague(gameState)?.id ?? DEFAULT_LEAGUE_ID;

  const effectiveUserSide = controlledSide ?? registrySide(userSide);
  const inferredWinnerSide =
    userResult === "win"
      ? effectiveUserSide
      : userResult === "loss"
        ? otherRegistrySide(effectiveUserSide)
        : undefined;
  const effectiveWinnerSide = winnerSide ?? inferredWinnerSide;

  const summary = snapshotToSummary(snapshot, userSide, effectiveUserSide, effectiveWinnerSide);
  const context = extractMatchContext({
    match: summary,
    userSide: effectiveUserSide,
    leagueId,
  });
  const result = context.facts.result as "win" | "loss";
  const candidates = buildCandidates({
    questions: SOCIAL_CONTENT_PACK.questions,
    leagueId,
    contextTags: context.tags,
    contextFacts: context.facts,
  });
  const coherentCandidates = candidates.filter((candidate) => isQuestionCoherentWithResult(candidate, result));
  const selectedCandidates = selectPressConferenceCandidates(coherentCandidates, random, recentQuestionIds);

  const fallbackResponses: PressResponse[] = result === "win"
    ? [
        {
          id: "credit-preparation",
          tone: t("content.lol.social.responses.creditPreparation.label"),
          text: t("content.lol.social.responses.creditPreparation.text"),
          effectId: "press_squad_morale_small_up",
          target: "squad",
        },
        {
          id: "stay-measured",
          tone: t("content.lol.social.responses.stayMeasured.label"),
          text: t("content.lol.social.responses.stayMeasured.text"),
          effectId: "press_no_effect",
          target: "none",
        },
      ]
    : [
        {
          id: "take-responsibility",
          tone: t("content.lol.social.responses.takeResponsibility.label"),
          text: t("content.lol.social.responses.takeResponsibility.text"),
          effectId: "press_squad_morale_small_up",
          target: "squad",
        },
        {
          id: "stay-measured",
          tone: t("content.lol.social.responses.stayMeasured.label"),
          text: t("content.lol.social.responses.stayMeasured.text"),
          effectId: "press_no_effect",
          target: "none",
        },
      ];

  if (selectedCandidates.length === 0) {
    return [
      {
        id: `fallback-post-match-${result}`,
        journalist: "Verified Analyst",
        outlet: "Rift Desk",
        question: result === "win"
          ? t("content.lol.social.questions.cleanWinObjectives.text")
          : t("content.lol.social.questions.mentalResetAfterLoss.text"),
        responses: fallbackResponses,
      },
    ];
  }

  return selectedCandidates.map((candidate) =>
    buildPressQuestion({
      candidate,
      contextFacts: context.facts,
      fallbackResponses,
      t,
    }),
  );
}
