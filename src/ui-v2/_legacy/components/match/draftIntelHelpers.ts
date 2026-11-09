export interface BanCandidateInput {
  championId: string;
  roleHints: string[];
}

export type BanMetaTier = "S" | "A" | "B" | "C" | "D";

export interface BanRecommendationContext {
  enemyMastery: number;
  metaScore: number;
  tier: BanMetaTier;
  roleHints: string[];
  roleAlreadyCovered: boolean;
  enemyJungleLocked: boolean;
  isFlexThreat: boolean;
  isSpecialThreat: boolean;
  draftHashSeed: string;
}

export interface BanScoringContext {
  tier?: BanMetaTier;
  roleAlreadyCovered?: boolean;
  enemyJungleLocked?: boolean;
  isFlexThreat?: boolean;
  isSpecialThreat?: boolean;
  draftHashSeed?: string;
}

interface RankBanCandidatesParams {
  available: BanCandidateInput[];
  enemyCoveredRoles: Set<string>;
  /** When provided, champions with no role in this set are excluded outright. */
  enemyFreeRoles?: Set<string>;
  resolveEnemyMastery: (championId: string) => number;
  resolveMetaScore: (championId: string) => number;
  resolveScoringContext?: (candidate: BanCandidateInput) => BanScoringContext;
}

export interface RankedBanCandidate {
  championId: string;
  enemyMastery: number;
  metaScore: number;
  score: number;
}

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function deterministicJitter(seed: string): number {
  const normalized = hashText(seed) % 1000;
  return normalized / 1000;
}

function tierPenaltyByTier(tier: BanMetaTier): number {
  if (tier === "D") return -35;
  if (tier === "C") return -10;
  if (tier === "B") return -3;
  return 0;
}

function metaScoreToTier(score: number): BanMetaTier {
  if (score >= 19) return "S";
  if (score >= 16) return "A";
  if (score >= 13) return "B";
  if (score >= 9) return "C";
  return "D";
}

export function computeBanRecommendationScore(context: BanRecommendationContext): number {
  const metaWeight = 3.2;
  const masteryWeight = 0.9;
  const signatureException = context.tier === "D" && context.enemyMastery >= 94 ? 24 : 0;
  const roleCoveredPenalty = context.roleAlreadyCovered && !context.isFlexThreat && !context.isSpecialThreat
    ? -12
    : 0;
  const jungleGuardrailPenalty = context.enemyJungleLocked
    && context.roleHints.includes("JUNGLE")
    && !context.isFlexThreat
    && !context.isSpecialThreat
    ? -25
    : 0;
  const flexThreatBonus = context.isFlexThreat ? 8 : 0;
  const specialThreatBonus = context.isSpecialThreat ? 10 : 0;
  const contextualJitter = deterministicJitter(`${context.draftHashSeed}:${context.tier}:${context.enemyMastery}`);

  return (
    context.metaScore * metaWeight +
    context.enemyMastery * masteryWeight +
    tierPenaltyByTier(context.tier) +
    signatureException +
    roleCoveredPenalty +
    jungleGuardrailPenalty +
    flexThreatBonus +
    specialThreatBonus +
    contextualJitter
  );
}

/**
 * Roles that can still be filled given the current picks, where each entry of
 * `selectionRoles` lists the roles that pick could play (an empty list means
 * any role). A role is free when the picks can be assigned unique roles
 * without using it. Unsatisfiable picks leave every role free.
 */
export function freeRolesForSelections(
  selectionRoles: string[][],
  roleOrder: readonly string[],
): Set<string> {
  const options = selectionRoles
    .map((roles) => (roles.length > 0 ? roles : [...roleOrder]))
    .sort((left, right) => left.length - right.length);

  const assignable = (index: number, used: Set<string>): boolean => {
    if (index >= options.length) return true;
    for (const role of options[index]) {
      if (used.has(role)) continue;
      used.add(role);
      if (assignable(index + 1, used)) return true;
      used.delete(role);
    }
    return false;
  };

  if (!assignable(0, new Set())) return new Set(roleOrder);
  return new Set(roleOrder.filter((role) => assignable(0, new Set([role]))));
}

export function championFitsFreeRole(roleHints: string[], freeRoles: Set<string>): boolean {
  if (freeRoles.size === 0) return false;
  if (roleHints.length === 0) return true;
  return roleHints.some((role) => freeRoles.has(role));
}

export function rankBanCandidates({
  available,
  enemyCoveredRoles,
  enemyFreeRoles,
  resolveEnemyMastery,
  resolveMetaScore,
  resolveScoringContext,
}: RankBanCandidatesParams): RankedBanCandidate[] {
  const feasible = enemyFreeRoles
    ? available.filter((champion) => championFitsFreeRole(champion.roleHints, enemyFreeRoles))
    : available;
  if (enemyFreeRoles && feasible.length === 0) return [];

  const roleRelevant = feasible.filter((champion) => {
    if (enemyCoveredRoles.size === 0) return true;
    if (champion.roleHints.length === 0) return true;
    return !champion.roleHints.every((role) => enemyCoveredRoles.has(role));
  });

  const banPool = roleRelevant.length > 0 ? roleRelevant : feasible;

  return banPool
    .map((candidate) => {
      const enemyMastery = resolveEnemyMastery(candidate.championId);
      const metaScore = resolveMetaScore(candidate.championId);
      const contextual = resolveScoringContext?.(candidate);
      const tier = contextual?.tier ?? metaScoreToTier(metaScore);
      const roleAlreadyCovered =
        contextual?.roleAlreadyCovered
        ?? (candidate.roleHints.length > 0 && candidate.roleHints.every((role) => enemyCoveredRoles.has(role)));
      const isFlexThreat = contextual?.isFlexThreat ?? candidate.roleHints.length >= 2;
      const isSpecialThreat = contextual?.isSpecialThreat ?? enemyMastery >= 97;
      const enemyJungleLocked = contextual?.enemyJungleLocked ?? enemyCoveredRoles.has("JUNGLE");
      const draftHashSeed = contextual?.draftHashSeed ?? `ban:${candidate.championId}`;

      const score = computeBanRecommendationScore({
        enemyMastery,
        metaScore,
        tier,
        roleHints: candidate.roleHints,
        roleAlreadyCovered,
        enemyJungleLocked,
        isFlexThreat,
        isSpecialThreat,
        draftHashSeed,
      });

      return {
        championId: candidate.championId,
        enemyMastery,
        metaScore,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);
}

export type DraftSide = "blue" | "red";

/**
 * Side whose players' mastery is relevant for the current draft step.
 * Picks are about the acting side's own players; bans target the opponent.
 */
export function resolveMasterySampleSide(
  step: { type: string; side: DraftSide } | null | undefined,
  controlledSide: DraftSide,
): DraftSide {
  if (!step) return controlledSide;
  if (step.type === "ban") return step.side === "blue" ? "red" : "blue";
  return step.side;
}

/** Minimum counter value for an enemy pick to be flagged against our last pick. */
export const COUNTER_LAST_PICK_WARN_THRESHOLD = 2;

/**
 * Whether an enemy pick counters our last own pick strongly enough to warn the
 * coach. `counterValue(source, target)` is how hard `source` counters `target`.
 */
export function enemyCountersLastOwnPick(
  lastOwnPick: string,
  enemyPick: string,
  counterValue: (source: string, target: string) => number,
): boolean {
  return counterValue(enemyPick, lastOwnPick) >= COUNTER_LAST_PICK_WARN_THRESHOLD;
}

export type MasteryBand = "high" | "medium" | "low";

export type GatedMastery =
  | { kind: "exact"; value: number }
  | { kind: "band"; band: MasteryBand; sortValue: number };

/** [PLACEHOLDER] band cut-offs and representative sort values; tune after playtests. */
const MASTERY_BAND_HIGH_MIN = 75;
const MASTERY_BAND_MEDIUM_MIN = 50;
const BAND_SORT_VALUE: Record<MasteryBand, number> = { high: 85, medium: 62, low: 30 };

export function masteryBand(mastery: number): MasteryBand {
  if (mastery >= MASTERY_BAND_HIGH_MIN) return "high";
  if (mastery >= MASTERY_BAND_MEDIUM_MIN) return "medium";
  return "low";
}

/**
 * Scouting gate for champion mastery shown to the user. The user's own players
 * and rival players covered by a scout report keep the exact value; any other
 * rival player only reveals a coarse band. AI draft logic never goes through here.
 */
export function gateMasteryReading(
  mastery: number,
  options: { isRivalSample: boolean; isScouted: boolean },
): GatedMastery {
  if (!options.isRivalSample || options.isScouted) return { kind: "exact", value: mastery };
  const band = masteryBand(mastery);
  return { kind: "band", band, sortValue: BAND_SORT_VALUE[band] };
}

export function gatedMasterySortValue(reading: GatedMastery): number {
  return reading.kind === "exact" ? reading.value : reading.sortValue;
}
