# Scrims System

This document tracks how scrims work, what is already implemented, and the staged plan for turning scrims into a playable competitive-preparation loop.

## Product Goal

Scrims must not be an isolated minigame. They should feed the same systems the player already understands:

- Champion mastery and champion pool development.
- Champion draft comfort, synergy, and preparation scores.
- Live match execution and preparation signals.
- Player profiles, visible form, and LoL-facing attributes.
- Team morale, fatigue, reputation, and staff recommendations.

The desired loop is:

1. Plan the week with Plan A/B/C opponents.
2. Set the weekly objective so practice has a clear intent.
3. Resolve requests and play the scrim block.
4. Generate a report: result, objective focus, issue, practiced champions, quality, morale/fatigue impact.
5. Let the manager choose a post-scrim response.
6. Apply consequences to champion mastery, player attributes, draft prep, livegame prep, and profiles.
7. Close the day with a readable report and longer-term trends.

## Current Implementation

Already implemented:

- Dedicated `Scrims` dashboard page.
- Weekly scrim volume controlled from Scrims, separate from Training.
- Optional weekly scrim objective, persisted as `scrim_weekly_objective`.
- Staff suggestions on the Scrims page based on objective, quality, cancellations, and loss streak.
- Plan A/B/C opponent planning per weekly slot.
- Deterministic fallback acceptance for Plan A/B/C.
- Scrim reputation and weekly cancellation counters.
- `cancel_todays_scrims` command with reputation cost.
- Home card showing today's activity and current day phase.
- Persisted `day_phase` with two phases:
  - `Morning`
  - `ScrimBlock`
- A day takes one press of Continue, or two on a scrim day: `Morning` -> the scrims are played -> `ScrimBlock`, where an unresolved scrim review blocks the advance until the manager decides -> the next press ends the day. Training is processed when the day ends.
- `ReviewBlock`, `TrainingBlock` and `Evening` were folded into `ScrimBlock` in 2026-11. Saves stored in any of them load as `ScrimBlock`.
- Recent played scrim reports feed `ChampionDraft` score bonuses for comfort, preparation, and synergy.
- Recent played scrim reports feed live match runtime through a conservative `lol_scrim_prep` payload.
- Weekly scrim staff report summarizes record, quality, focus, recurring issue, practiced champion, and recommendation.
- Weekly report focus/issue/recommendation params are i18n-keyed for localized inbox rendering.

Current limitation:

- Scrims are still mostly resolved inside daily training processing.
- Phase advancement is partially visual: `ScrimBlock` does not yet independently apply all gameplay consequences. (This line named `ReviewBlock` and `TrainingBlock` before they were folded into `ScrimBlock` in 2026-11.)
- Legacy scrim result data remains thin: opponent, slot, week, win/loss.
- Enriched scrim reports now exist, but they are still generated from the current daily training flow until `ScrimBlock` is split out.
- Player profiles now prefer persisted `champion_masteries`, with seed data as fallback.
- Post-match result screens mention active scrim preparation when it carried into the match.

## Rework Blueprint

This section is the source of truth for the next rework. Do not keep adding UI patches on top of the current mixed state. The main problem is not one broken component; it is that Home, Scrims, Training, and day phases currently infer scrim state from different pieces of data.

The rework goal is simple:

- One derived scrim context.
- One weekly preparation room.
- One daily scrim/review flow.
- Clear rules for what the user can do at each state.

### Core Problem To Fix

Current code often asks questions like:

- Is there a scrim slot today?
- Is the day phase `ReviewBlock`? (Now `ScrimBlock`; `ReviewBlock` was folded into it in 2026-11.)
- Does a report exist?
- Does the plan have an opponent?
- Is there a legacy `scrim_slot_result`?

Those questions are implementation details. UI should not independently combine them. UI should receive a clear answer:

```ts
type ScrimDayState =
  | "NoScrimToday"
  | "Planned"
  | "Confirmed"
  | "PlayedNeedsReview"
  | "Reviewed"
  | "Cancelled";
```

If a component needs to know whether to show `Cancel Today`, it should ask `canCancel`, not re-derive state from calendar slots and reports. If a component needs to know whether to show review options, it should ask `canReview`, not inspect `day_phase` manually.

### New Derived Contexts

Create two derived context helpers first. Start frontend-only if speed matters, then move/duplicate in backend once stable.

Recommended frontend path:

- `src/lib/scrimContext.ts`

Recommended exports:

```ts
export interface TodayScrimContext {
  state: ScrimDayState;
  slotIndex: number | null;
  opponentTeamId: string | null;
  resolvedOpponentTeamId: string | null;
  objective: ScrimFocus | null;
  report: ScrimReportData | null;
  canEditPlan: boolean;
  canCancel: boolean;
  canReview: boolean;
  canViewWeeklyPlan: boolean;
  primaryAction: "OpenPlan" | "Review" | "Training" | "Schedule" | null;
}

export interface WeeklyScrimSlotContext {
  slotIndex: number;
  weekday: number;
  label: string;
  plan: string[];
  resolvedOpponentTeamId: string | null;
  report: ScrimReportData | null;
  status: "Open" | "Locked" | "Played" | "Reviewed" | "Cancelled";
  canEdit: boolean;
}

export interface WeeklyScrimContext {
  weekKey: string;
  objective: ScrimFocus | null;
  capacity: number;
  reputation: number;
  cancellations: number;
  played: number;
  wins: number;
  losses: number;
  lossStreak: number;
  slots: WeeklyScrimSlotContext[];
  latestReports: ScrimReportData[];
  staffAdvice: string[];
}
```

Required helpers:

```ts
deriveTodayScrimContext(gameState, team): TodayScrimContext
deriveWeeklyScrimContext(gameState, team): WeeklyScrimContext
```

All UI should consume these helpers instead of duplicating scrim derivation logic.

### State Rules

Use these rules consistently:

- `NoScrimToday`: no planned/resolved scrim slot for today. Home should show training/prep, not scrim reputation.
- `Planned`: there is a scrim slot today, the scrim has not resolved, and `day_phase === "Morning"`. Home may show `Cancel Today` and `OpenPlan`.
- `Confirmed`: optional future state if request acceptance becomes explicit before playing. Do not add UI for this until backend exposes it.
- `PlayedNeedsReview`: a report exists today with `post_decision == null`. Home should show review state only; no cancel, no plan editing primary CTA, no scrim reputation pill.
- `Reviewed`: today's report exists and has `post_decision`. Home should show training/evening state, not review actions.
- `Cancelled`: today had a scrim slot but it was cancelled. Home should show cancellation/rest/training state, not Scrims CTA.

The `day_phase` is important, but it is not enough by itself. The derived context must combine phase, reports, slots, and cancellation state once.

### Target Screen Structure

#### Home Today Card

Home should be minimal and action-oriented.

Allowed Home states:

- Official match today: show match CTA.
- Scrim planned and cancellable: show opponent, objective, `OpenPlan`, `Cancel Today`.
- Scrim played and unresolved: show review summary and review decision CTA/options.
- Scrim reviewed: show training/preparation follow-up.
- No scrim: show training/preparation.

Home must not show:

- Scrim reputation when there is no scrim action available.
- `Cancel Today` after a scrim has resolved.
- Generic `Scrims` navigation while the `ScrimBlock` review is unresolved.
- Plan A/B/C details; that belongs in the Scrims page.

#### Scrims Page: Weekly Prep Room

The Scrims page should be organized as a preparation room, not a dumping ground.

Recommended sections in order:

1. Week header: objective, capacity, record, next official rival if available.
2. Staff advice: derived from objective, reports, opponent strength, reputation, cancellations, and fatigue/morale later.
3. Weekly plan: per-slot cards with Plan A/B/C and resolved state.
4. Today block: if today has scrim/review, show focused daily action.
5. Recent reports: compact, readable, actionable.
6. Weekly report: show latest Sunday summary inside Scrims, not only Inbox.

Avoid placing too much behavior in one card. The current `ScrimPlanningCard` should remain planning-only.

#### Daily Scrim Block

The daily block should answer: what happens today?

Before resolution:

- Opponent or open plan.
- Objective/focus.
- Risk: opponent OVR, scrim reputation gap, cancellation cost.
- Primary action: advance/resolve via normal day flow.
- Secondary action: cancel if allowed.

After resolution:

- Result.
- Quality.
- Issue detected.
- Practiced champions.
- Morale/fatigue impact preview.

#### Review Room

Review is the most important gameplay moment. It should be visually separate and decision-oriented.

Each decision card must show tradeoffs:

- `VodReview`: more prep/draft/macro learning, small condition cost.
- `MentalReset`: morale/condition recovery, less technical growth.
- `TargetedDrills`: stronger issue/champion mastery progress, condition cost.
- `PushThrough`: maximum raw learning, fatigue/tilt risk after bad losses.

Acceptance:

- The player should understand why one option is good or bad before clicking.
- Do not hide all effects behind backend formulas.

#### Weekly Report

The weekly report should be visible in Scrims page and optionally mirrored to Inbox.

It should include:

- Objective.
- Played/wins/losses/cancellations.
- Average quality.
- Main focus.
- Recurring issue.
- Most practiced champion.
- Most benefited player if available.
- Recommendation for next week.
- Whether the weekly objective was fulfilled, partially fulfilled, or failed.

### Backend Direction

Current storage can remain compatible, but behavior should move toward explicit contexts.

Near-term backend commands can stay:

- `set_weekly_scrim_objective`
- `set_weekly_scrim_plans`
- `set_weekly_scrim_slots`
- `cancel_todays_scrims`
- `choose_post_scrim_decision`

Recommended future backend query/command:

```rust
get_scrim_context() -> ScrimContextResponse
```

Shape:

```ts
interface ScrimContextResponse {
  today: TodayScrimContext;
  week: WeeklyScrimContext;
}
```

Reason:

- Frontend should not permanently own all state derivation.
- Backend already knows persistence and phase rules.
- Central context reduces UI bugs caused by re-deriving state in multiple components.

Do not introduce this backend command until the frontend helper is stable and tests prove the desired states.

### Frontend Contract Snapshot (Ready For Backend Parity)

The frontend contract is now stable enough to mirror in backend `get_scrim_context`.

Current stable shape in `src/lib/scrimContext.ts`:

```ts
interface TodayScrimContext {
  state: ScrimDayState;
  slotIndex: number | null;
  opponentTeamId: string | null;
  resolvedOpponentTeamId: string | null;
  objective: ScrimFocus | null;
  report: ScrimReportData | null;
  canEditPlan: boolean;
  canCancel: boolean;
  canReview: boolean;
  canViewWeeklyPlan: boolean;
  hasOfficialMatch: boolean;
  primaryAction: "OpenPlan" | "Review" | "Training" | "Schedule" | null;
}

interface WeeklyScrimSlotContext {
  slotIndex: number;
  weekday: number;
  label: string;
  labelDay: number;
  labelSuffix: string;
  plan: string[];
  resolvedOpponentTeamId: string | null;
  resultWon: boolean | null;
  report: ScrimReportData | null;
  status: "Open" | "Locked" | "Played" | "Reviewed" | "Cancelled";
  canEdit: boolean;
}

interface WeeklyScrimContext {
  weekKey: string;
  objective: ScrimFocus | null;
  capacity: number;
  planned: number;
  reputation: number;
  cancellations: number;
  played: number;
  wins: number;
  losses: number;
  lossStreak: number;
  avgQuality: number;
  topFocus: ScrimFocus | null;
  topIssue: string | null;
  nextOfficialRivalTeamId: string | null;
  nextOfficialRivalCompetition: string | null;
  slots: WeeklyScrimSlotContext[];
  latestReports: ScrimReportData[];
}
```

Recommended backend response to implement later:

```ts
interface ScrimContextResponse {
  today: TodayScrimContext;
  week: WeeklyScrimContext;
}
```

Parity notes:

- Keep `WeeklyScrimSlotContext.label` + `labelDay` + `labelSuffix` as data, so UI does not re-derive label semantics.
- Keep merged Plan A/legacy fallback logic in one place (backend once migrated).
- Preserve `resultWon` as nullable to distinguish unresolved from played outcomes.

### Implementation Order For Rework

1. Create `src/lib/scrimContext.ts` with `deriveTodayScrimContext` and `deriveWeeklyScrimContext`.
2. Move date/week/slot helpers out of `HomeTodayPlanCard`, `ScrimsTab`, and `ScrimPlanningCard` into `scrimContext.ts` or a small `scrimSchedule.ts` helper.
3. Update `HomeTodayPlanCard` to consume `TodayScrimContext` only.
4. Update `ScrimsTab` to consume `WeeklyScrimContext` only.
5. Keep `ScrimPlanningCard` focused on editing `WeeklyScrimSlotContext[]`.
6. Add tests for every `ScrimDayState`.
7. Add tests for weekly context: no plan, plan A only, Plan A/B/C, played, reviewed, cancelled, past locked slot.
8. Only after frontend context is stable, consider exposing `get_scrim_context` from Tauri/backend.

### Tests Required Before Calling The Rework Done

Minimum frontend tests:

- `deriveTodayScrimContext` returns `NoScrimToday` when no slot today.
- Returns `Planned` in `Morning` with unresolved slot.
- Returns `PlayedNeedsReview` when today's report has no `post_decision`.
- Returns `Reviewed` when today's report has `post_decision`.
- Returns no `canCancel` after report exists.
- Returns no `canEditPlan` for past/resolved slots.
- Weekly context preserves Plan A/B/C order.
- Weekly context handles long team names without layout assumptions.

Minimum UI tests:

- Home does not show cancel/reputation during review.
- Home shows cancel/reputation only for cancellable planned scrim.
- Scrim planning renders long names without table layout assumptions.
- Select opens upward when forced/auto near bottom.

Minimum backend tests if backend context is added:

- Context serialization is stable.
- Existing saves without `scrim_weekly_objective` load correctly.
- Cancelled scrims do not later generate reports.
- `process_scrim_block` stays idempotent.
- `choose_post_scrim_decision` cannot apply twice.

Backend parity tests to add when `get_scrim_context` is introduced:

- `today.state` transitions match frontend helper for:
  - `NoScrimToday`
  - `Planned`
  - `PlayedNeedsReview`
  - `Reviewed`
  - `Cancelled`
- `week.slots[*]` preserves Plan A/B/C order and `canEdit` lock semantics.
- `week.slots[*].status` parity for `Open/Locked/Played/Reviewed/Cancelled`.
- `week` summary parity (`planned`, `avgQuality`, `topIssue`, `nextOfficialRivalTeamId`).
- `labelDay` / `labelSuffix` are stable for duplicate weekday slots (A/B variants).

### UX Rules

- If there is no action, do not show a CTA.
- If the scrim already happened, do not show cancel.
- If the user is in review, show review as the primary experience.
- If a stat does not help the current decision, hide it or move it to Scrims page.
- Never make Home explain the whole scrim system.
- Never make the user infer state from phase labels.
- Names can be long. Layout must use `min-w-0`, truncation, wrapping, or cards instead of rigid tables.
- Dropdowns near the bottom must open upward or be scroll-safe.

### What To Keep

- `ScrimReport` model.
- `PostScrimDecision` enum.
- `scrim_weekly_objective`.
- Plan A/B/C concept.
- `lol_scrim_prep` integration.
- Champion mastery integration.
- Weekly report concept.

### What To Simplify Or Remove

- Repeated slot/week/day calculations in components.
- UI that directly checks `day_phase` and reports independently.
- Home reputation pill except during actionable planning.
- Generic Scrims navigation from review states.
- Any new feature that does not connect to `TodayScrimContext` or `WeeklyScrimContext`.

### Definition Of Done

The rework is done when a user can answer these questions without reading implementation details:

- What are we preparing this week?
- Who are we scrimming and why?
- What happened today?
- What decision do I need to make now?
- What changed because of that decision?
- What should I do next week?

If the UI cannot answer those questions, the system is still not finished.

## Post-Rework Next Steps (Backend Parity Phase)

Status:

- Step 7: ✅ Done (`get_scrim_context` backend command implemented)
- Step 8: ✅ Done (Scrims/Home/Schedule switched to backend context with shared fallback hook)
- Step 9: ✅ Done (backend/frontend parity mapper tests added and fallback flow centralized)

All frontend rework steps are complete. The remaining work is backend parity so frontend can consume one canonical response.

### Step 7 — Implement `get_scrim_context` (Backend Query)

Goal:

- Expose one backend query that returns `today` + `week` contexts with the same semantics as frontend helpers.

Suggested command signature:

```rust
get_scrim_context() -> ScrimContextResponse
```

Requirements:

- Return `TodayScrimContext` parity fields used by Home/Scrims.
- Return `WeeklyScrimContext` parity fields used by Scrims/Schedule.
- Keep legacy fallback merge behavior for plan/opponent compatibility.

### Step 8 — Frontend Switch To Backend Context

Goal:

- Replace direct `deriveTodayScrimContext` / `deriveWeeklyScrimContext` calls in UI with backend `get_scrim_context` payload.

Requirements:

- Add compatibility fallback: if backend payload missing, use current frontend helper temporarily.
- Keep UI behavior unchanged (only data source changes).

### Step 9 — Parity Verification + Cleanup

Goal:

- Prove backend context behavior matches current frontend contract, then remove duplicate derivation paths.

Requirements:

- Add backend parity tests listed in this document.
- Remove frontend-only fallback derivation once parity is proven.
- Keep one source of truth (backend) and one rendering layer (frontend).

## Gameplay Activation Plan (Mandatory)

This plan exists to ensure scrims are meaningful gameplay (not a passive "continue" flow).

### Step G1 — Review Room With Visible Tradeoffs

Goal:

- Make post-scrim decisions explicitly impactful and understandable.

Deliverables:

- Decision cards for `VodReview`, `MentalReset`, `TargetedDrills`, `PushThrough`.
- Each card shows:
  - Benefits
  - Costs
  - "When to pick" guidance
  - Risk level
- Selected decision shows immediate feedback summary (what changed now).

Acceptance:

- Player can explain why one decision is better than another before clicking.
- UI communicates both upside and downside for each option.

### Step G2 — Daily Scrim Block Becomes Decision Point

Goal:

- Make "today" a tactical call, not a passive phase transition.

Deliverables:

- Show opponent pressure signal (OVR/reputation gap class: low/medium/high).
- Show expected learning value (low/medium/high).
- Show cancellation cost preview before action.
- Show staff recommendation with explicit rationale.

Acceptance:

- Player sees risk/reward before pressing continue.

### Step G3 — Post-Scrim Feedback Loop

Goal:

- Ensure outcomes feel consequential and legible.

Deliverables:

- Scrim result summary card with:
  - Result + quality
  - Issue detected
  - Practiced champion highlights
  - Positive/negative impact notes
- Decision confirmation strip after review choice with immediate effects.

Acceptance:

- Player can identify what improved and what got worse after each scrim day.

### Step G4 — Weekly Closure and Next-Week Guidance

Goal:

- Close the loop with actionable planning guidance.

Deliverables:

- Weekly outcome: objective fulfilled / partial / failed.
- Main gain + main failure.
- Recommendation for next week with one concrete action.

Acceptance:

- Weekly report tells player exactly what to do next.

### Execution Order

1. G1 (Review Room)
2. G2 (Daily Scrim decision signals)
3. G3 (Immediate feedback)
4. G4 (Weekly closure)

## Execution Stages E (Current rollout)

### E6 — Validation & Regression Net

Goal:

- Lock the 2/4/6 model and mandatory review flow with tests so future UI/backend changes do not regress gameplay clarity.

Status:

- Completed.

Coverage closed in this stage:

- Fixed weekly slot distribution for 2/4/6 (`[2,2]`, `[2,2,3,3]`, `[2,2,3,3,4,4]`).
- Normalization behavior for odd/legacy values (1→2, 3→4, 5→6).
- Weekly context consistency while changing volume (2→6→4).
- Advance-time blocker for unresolved post-scrim decisions (`blocked_scrim_decision`).
- Scrims Today Block interactions for manual decision and assistant delegation.
- PushThrough critical-cost warning visibility under risky context.

Primary test files:

- `src/lib/scrimContext.test.ts`
- `src/hooks/useAdvanceTime.test.tsx`
- `src/components/scrims/ScrimsTab.interaction.test.tsx`
- `src/components/home/HomeTodayPlanCard.test.tsx`
- `src/services/trainingService.test.ts`

### E7 — Assistant Automation (Started)

Goal:

- Reduce friction in mandatory review flow by allowing assistant-managed resolution when the user opts in.

Status:

- In progress (vertical slice 1 + settings exposure).

Implemented in this slice:

- New app setting `scrim_review_mode: "manual" | "assistant"` (default `manual`).
- `useAdvanceTime` now receives `scrim_review_mode` from Dashboard settings.
- When `advance_time_with_mode` returns `blocked_scrim_decision` and mode is `assistant`, frontend:
  1. calls `delegate_scrim_decision`,
  2. retries `advance_time_with_mode`,
  3. only shows blocker if auto-delegation cannot unlock the flow.
- Added unit coverage for the auto-delegate + retry path.
- Exposed `scrim_review_mode` in Settings > Gameplay so users can choose Manual vs Assistant behavior.
- Added explicit in-dashboard info notice when Continue auto-delegates a blocked scrim decision.
- Added skip-to-match-day parity: when blocked by pending scrim review and mode is Assistant, skip now auto-delegates and retries once.

Next E7 slices:

1. Add i18n keys for new setting label/options and auto-delegation notice in locale bundles.
2. Consider exposing an audit trail entry in Inbox when assistant auto-resolves review decisions.
3. Evaluate whether auto-delegation should be restricted to specific phases (e.g., ReviewBlock only; `ReviewBlock` was folded into `ScrimBlock` in 2026-11) for stricter UX control.

### E8 — ScrimBlock Decision Loop (New)

Goal:

- Move decision gameplay to `ScrimBlock` with explicit A/B block control, so scrims are interactive, consequential, and not passive "continue" spam.

Locked product requirements:

- Weekly volume remains `2 / 4 / 6`.
- Scrims run as two blocks per day:
  - 2 scrims: Wednesday A/B
  - 4 scrims: Wednesday A/B + Thursday A/B
  - 6 scrims: Wednesday A/B + Thursday A/B + Friday A/B
- In `ScrimBlock`, show scrim result first (not generic post-review framing).
- After first block result:
  - Continue to second block.
  - Cancel second block and pick response (`VodReview`, `MentalReset`, `TargetedDrills`).
  - If loss streak / severe loss / loss vs weaker rival, continue path becomes contextual `PushThrough` (higher learning, morale+condition penalty).
- After second block result:
  - Give rest of day off (recovery) OR pick response options (`VodReview`, `MentalReset`, `TargetedDrills`, contextual `PushThrough`).
- No advance allowed until an option is selected (unless assistant mode resolves it).

Status:

- Closed (v1).

Implemented in E8 v1:

1. Context + UI semantics
   - Added explicit block framing in Home (`Resultado bloque A/B`, `Scrim 1/2` or `2/2`).
2. ScrimBlock gating
   - Pending block decisions are handled in `ScrimBlock` flow and no longer depend on generic review framing.
3. Block-1 behavior
   - First-block decisions split into:
     - continue path (`PushThrough` contextual when risk is high),
     - or cancel-next-block path (`VodReview`, `MentalReset`, `TargetedDrills`).
4. Backend cancel-next implementation
   - Choosing `VodReview` / `MentalReset` / `TargetedDrills` on block 1 auto-cancels the next same-day block and applies weekly cancellation + reputation impact.
5. Assistant parity
   - Assistant mode supports unblock flows in Continue/Skip and keeps visible notice in dashboard.
6. Validation
   - Updated/added tests for block semantics and decision visibility behavior in Home/Scrims.

Follow-up (post-E8):

1. Add explicit backend/UI action for "rest of day" as first-class decision (currently represented through the existing response set, mainly `MentalReset`).
2. Add deeper integration tests for full A→B day transitions with mixed decision paths.

### E9 — Day-Off Decision + A/B Integration Hardening

Goal:

- Complete block-based day flow by adding an explicit "rest of day" decision and hardening mixed A→B paths.

Status:

- Closed (v1).

Implemented:

1. New explicit decision: `DayOff`
   - Added to frontend and backend post-scrim decision model.
   - Available as first-class option on second daily block framing.
2. Backend validation
   - `DayOff` is restricted to second daily block context.
3. Backend behavior
   - `DayOff` applies strong recovery effects (morale/condition) and reduced technical pressure.
4. A/B mixed path behavior
   - First-block non-PushThrough choices (`VodReview`, `MentalReset`, `TargetedDrills`) cancel next same-day block and apply cancellation/reputation impact.
5. Tests
   - Added/updated coverage for block semantics and DayOff visibility path in Home.

### E10 — Daily Scrim Flow from Diagram

Goal:

- Rebuild daily scrim behavior around the actual desired loop: select scrims at the beginning of the day, resolve one block, branch on result quality, and never auto-generate the second block before the player chooses what to do.

Status:

- Started.

Locked flow:

1. Start of scrim day: select the day's scrims explicitly.
   - No random/fallback opponent selection during resolution.
   - If no opponent is selected, that block is not played.
2. Resolve block 1 result.
3. Branch on block 1 result:
   - Good result:
     - Offer rest (cancels remaining scrims that day).
     - Continue to second block.
   - Bad result:
     - Push Through (continue to second block, higher learning, morale/condition penalty).
     - Cancel scrims, then choose response: `VodReview`, `MentalReset`, or `TargetedDrills`.
4. Resolve block 2 only after a continue/push-through decision.
5. Branch on block 2 result:
   - Good result:
     - Day off / rest.
   - Bad result:
     - Day off / rest.
     - `VodReview`.
     - `MentalReset`.
     - `TargetedDrills`.

Hard rules:

- Block 2 must never be generated before the block 1 decision.
- PushThrough is not a generic review option; it is a block-1 bad-result continue path.
- The UI must not show both block decisions at once.
- Result quality (good/bad) drives available actions.

Implementation slices:

1. Stop automatic/fallback opponent resolution during scrim block. ✅
2. Resolve only the earliest unresolved selected block for the day. ✅
3. Add explicit daily flow actions and backend commands. ✅
   - `ContinueToBlock2`
   - `OfferRest`
   - `DayOff`
   - `PushThrough`
   - `VodReview`
   - `MentalReset`
   - `TargetedDrills`
4. Replace generic review cards with diagram-based action sets. ✅ (Home v1)
5. Add integration tests proving A before B, no double pending decisions, and visible impact.

## Target Gameplay Model

### Morning

Manager answers: what risk do we take today?

Actions:

- Review today's schedule.
- Confirm or cancel scrims.
- Adjust weekly plan before unresolved slots.
- Read staff recommendation.

Effects:

- Cancelling protects recovery but hurts scrim reputation.
- Confirmed scrims proceed into `ScrimBlock`.

### ScrimBlock

Manager answers: what actually happened in practice?

Actions:

- Resolve today's scrim requests.
- Simulate played scrims.
- Generate a `ScrimReport`.

Effects:

- Result affects weekly record and scrim reputation.
- Scrim quality and opponent strength affect learning.
- Practiced champion picks can gain mastery.
- Issues are detected for review.

### Review decision (inside `ScrimBlock`)

Formerly the `ReviewBlock` phase; folded into `ScrimBlock` in 2026-11.

Manager answers: how do we respond to what we learned?

While today's report has no `post_decision`, the advance is blocked (`blocked_scrim_decision`).

Decision options:

- `VodReview`: converts mistakes into macro/draft learning, softer morale damage, lower recovery.
- `MentalReset`: protects morale and condition, less technical growth.
- `TargetedDrills`: improves the detected issue and champion comfort, costs fatigue.
- `PushThrough`: maximizes training volume, risks tilt/fatigue if the scrim went badly.

Effects:

- Stores a post-scrim decision for the day.
- Modifies the training processed when the day ends and live/draft preparation signals.

### Day end (training and digest)

Formerly the `TrainingBlock` and `Evening` phases; folded into `ScrimBlock` in 2026-11. There is no separate phase: the press of Continue that ends the day (the second press on a scrim day, the only one otherwise) does all of this.

Manager answers: how does practice shape player development, and what did the day leave behind?

Effects:

- Applies normal training.
- Applies post-scrim modifiers.
- Updates LoL-facing player attributes conservatively.
- Applies champion mastery progress for practiced champions.
- Advances date.
- Resets phase to `Morning`.
- Generates digest/report messages.
- Updates weekly trends and staff recommendations.

## Data Model Plan

Recommended minimal model:

```rust
pub struct ScrimReport {
    pub date: String,
    pub week_key: String,
    pub slot_index: u8,
    pub team_id: String,
    pub opponent_team_id: String,
    pub status: ScrimStatus,
    pub won: Option<bool>,
    pub focus: ScrimFocus,
    pub issue: Option<ScrimIssue>,
    pub severity: u8,
    pub quality: u8,
    pub player_champion_picks: Vec<ScrimChampionPick>,
    pub post_decision: Option<PostScrimDecision>,
}

pub struct ScrimChampionPick {
    pub player_id: String,
    pub champion_id: String,
    pub role: String,
}
```

Recommended enums:

```rust
pub enum ScrimStatus {
    Pending,
    Accepted,
    Rejected,
    Cancelled,
    Played,
}

pub enum ScrimFocus {
    DraftPrep,
    ChampionPool,
    EarlyGame,
    Teamfighting,
    Macro,
    Mental,
}

pub enum ScrimIssue {
    DraftGap,
    LanePressure,
    ObjectiveSetup,
    TeamfightExecution,
    ChampionComfort,
    Tilt,
}

pub enum PostScrimDecision {
    VodReview,
    MentalReset,
    TargetedDrills,
    PushThrough,
}
```

## Integration Points

### Champion Mastery

Scrims should call a dedicated mastery function, not reuse official match progression directly.

Reason:

- Official matches should remain the strongest competitive mastery source.
- Training remains slower but targeted.
- Scrims sit in the middle: contextual, champion-specific, and affected by quality/review.

Recommended behavior:

- Scrim loss against strong opponent can still generate high learning.
- `ChampionPool` and `TargetedDrills` increase champion mastery odds.
- `VodReview` improves macro/draft learning more than raw champion mastery.
- `MentalReset` lowers learning but protects morale.

Status:

- Implemented: `apply_scrim_mastery_progress` applies conservative, report-quality-based mastery gains from scrim champion picks.
- Gains are lower than official match progression and are improved by high quality, wins, `TargetedDrills`, `VodReview`, or strong `PushThrough` reports.

### ChampionDraft

Scrims should feed existing draft score concepts:

- `comfort`: recent practice on selected champions.
- `preparation`: recent prep against the opponent/style.
- `synergy`: multiple players practiced a related plan.
- `counter`: only affected when scouting/review specifically identified a draft gap.

Avoid generic hidden bonuses. Draft UI should explain why a pick is more comfortable/prepared.

Status:

- Implemented: `ChampionDraft` reads the last played reports for each side and adds capped bonuses:
- `comfort`: selected champions recently practiced by the same player.
- `preparation`: recent played reports against the upcoming opponent, with stronger value for `DraftPrep` or `VodReview`.
- `synergy`: two or more selected champions were practiced together in a recent scrim report.
- UI shows a compact `Scrim prep` explanation when these bonuses are active.

### LiveGame

Scrims should feed livegame as a small preparation signal, not a magic win modifier.

Possible payload:

```ts
lol_scrim_prep: {
  home: {
    preparation: number;
    focus: "Macro" | "Teamfighting" | "EarlyGame" | "Mental" | "ChampionPool" | "DraftPrep";
    comfortByPlayer: Record<string, number>;
  };
  away: ...;
}
```

Examples:

- `Macro`: better objective setup and decisions.
- `Teamfighting`: slightly better grouped-fight execution.
- `EarlyGame`: slightly better lane/jungle early setup.
- `MentalReset`: reduces negative tilt from loss streaks.

Status:

- Implemented: `MatchSimulation` attaches `lol_scrim_prep` to the runtime snapshot.
- Implemented: Rust sim v2 reads the payload during champion initialization.
- Effects are deliberately small: preparation and player champion comfort reduce decision jitter and apply narrow execution modifiers based on focus.
- Implemented: result screens show a compact explanation when scrim prep was active.

### Player Profiles

Player profiles must show persisted `champion_masteries`.

Reason:

- If scrims improve champion mastery but profiles still read static seed data, the player cannot see the consequence.
- Visible feedback is mandatory for the loop to feel real.

Status:

- Implemented: `PlayerProfile` prefers persisted `gameState.champion_masteries` over seed-only mastery data.

### Player Attributes

Use existing LoL-facing attribute mappings:

- Mechanics: `dribbling`, `agility`.
- Laning: `shooting`, `positioning`.
- Teamfighting: `teamwork`, `composure`, `stamina`.
- Macro: `vision`, `decisions`, `positioning`.
- Champion pool: `agility`, `passing`, champion mastery.
- Discipline: `composure`, `decisions`, `leadership`.

Scrim effects should be smaller than official match post-match development and should usually require a review/training decision to become attribute growth.

## Implementation Stages

### Stage 1: Visible Mastery Loop

Goal:

- Make existing persisted champion mastery visible in player profiles.

Status:

- Implemented.

Acceptance:

- Player profile uses `gameState.champion_masteries` for the selected player.
- Seed data remains fallback for new saves or players with no persisted mastery.

### Stage 2: Enriched Scrim Report

Goal:

- Replace thin W/L slot result with a richer report model.

Acceptance:

- Scrim result stores status, quality, issue, severity, focus, and practiced champion picks.
- Scrims page and Home can show the report.

Status:

- Implemented as a compatible persistence layer.
- Reports are generated from the current scrim resolution path.
- `scrim_slot_results` remains available for legacy UI compatibility.

### Stage 3: ScrimBlock Resolution

Goal:

- Resolve today's scrims during `ScrimBlock`, not at end-of-day training.

Acceptance:

- Advancing into/through `ScrimBlock` generates reports for today's slots.
- The game waits in `ScrimBlock` for the manager's review decision before the day ends.

Status:

- Partially implemented: entering `ScrimBlock` now resolves today's scrims and creates enriched reports.
- Scrim resolution is idempotent, so day-end processing (the former `TrainingBlock`/Evening phases) does not duplicate reports or weekly counters.
- Implemented: the review decision (then the `ReviewBlock` phase, now part of `ScrimBlock`) exposes explicit manager response choices for unresolved reports.

### Stage 4: Post-Scrim Decisions

Goal:

- Add `VodReview`, `MentalReset`, `TargetedDrills`, and `PushThrough`.

Acceptance:

- Home shows the latest unresolved scrim report in `ScrimBlock`.
- Decision is stored and affects the training processed when the day ends.

Status:

- Implemented as first vertical slice.
- `VodReview` improves report quality and softens severity, with light condition cost.
- `MentalReset` restores morale/condition and softens severity.
- `TargetedDrills` improves report quality with extra condition cost.
- `PushThrough` maximizes report quality but costs condition and can hurt morale after severe losses.
- Scrim champion picks now feed `champion_masteries` after the manager chooses a response.

### Stage 5: Draft Preparation

Goal:

- Feed recent scrim prep into ChampionDraft scoring.

Acceptance:

- Draft score reflects recent champion comfort and preparation.
- UI explains the source of the prep bonus.

Status:

- Implemented as a capped draft score signal from recent played `scrim_reports`.

### Stage 6: LiveGame Preparation

Goal:

- Feed recent scrim prep into live match runtime as conservative execution signals.

Acceptance:

- Runtime receives a `lol_scrim_prep` payload.
- Effects are small, specific, and visible in explanations/reports.

Status:

- Implemented as a first runtime slice.
- Pending: expose post-match explanations/reports that mention the active scrim prep signal.

### Stage 7: Weekly Scrim Report

Goal:

- Summarize trends and staff recommendations.

Acceptance:

- Weekly report includes record, reputation changes, recurring issue, best practiced champions, and recommendation.

Status:

- Implemented as an enriched Sunday staff inbox report.
- Includes played/wins/losses/cancellations, average quality, current loss streak, main focus, recurring issue, most practiced champion, and staff recommendation.

## Current Step

Current implementation step:

- Scrim loop vertical slice is complete through weekly reporting and post-match visibility.

Next intended step:

- Continue tightening copy/localization for generated labels as more scrim report variants are added.

UI ownership note:

- Implemented: the weekly planning card now lives as `ScrimPlanningCard` under `src/components/scrims`.
- Implemented: post-match scrim prep insight title, summary, details, and focus labels resolve through frontend i18n keys.
- Implemented: weekly scrim staff recommendations now travel as recommendation i18n keys instead of raw English text.
