# Tactics — Architecture & Usage

## Overview

The Tactics page lets the manager define **how the team plays in the Rift** across
6 tactical dimensions. Each choice affects role effectiveness (modifiers),
internal synergy (coherence), and live match simulation (macro AI + combat
stats).

---

## Data flow

```
UI selection (TacticsTabV2)
       │
       ▼
invoke("set_lol_tactics", { lolTactics: {...} })
       │
       ▼
Rust: team.lol_tactics = new_tactics
       │
       ▼
StateManager.set_game(game)
       │
       ▼
Returns full Game → frontend re-renders
       │
       │  ┌────────────────────────────────────┐
       ├──┤ computeRoleModifiers(tactics)      │  ← lolTactics.ts
       │  │  → Record<DraftRole, number>       │
       │  └────────────────────────────────────┘
       │
       │  ┌────────────────────────────────────┐
       ├──┤ computeCoherenceBreakdown(tactics) │
       │  │  → { label, delta }[]              │
       │  └────────────────────────────────────┘
       │
       ▼
Draft simulator (optional)
  ├── role_modifiers → combat stat multipliers
  └── coherenceScore → score prediction

Live match runtime (Rust)
  ├── RuntimeTeamTactics → macro AI behavior
  └── role_impact_by_player → combat stat scaling
```

---

## The 6 tactical dimensions

| Section | Icon | Options | What it controls |
|---|---|---|---|
| **Strong side** | Shield/Brain/Crosshair | `Top` / `Mid` / `Bot` | Which lane gets priority resources |
| **Game timing** | Flame/Scale/Feather | `Early` / `Mid` / `Late` | Power spike window |
| **Jungle style** | Crosshair/Zap/Feather/Brain | `Ganker` / `Invader` / `Farmer` / `Enabler` | Jungler playstyle |
| **Jungle pathing** | ArrowDown/ArrowUp | `TopToBot` / `BotToTop` | Jungle clear direction |
| **Fight plan** | Shield/Crosshair/Zap/Brain | `FrontToBack` / `Pick` / `Dive` / `Siege` | Teamfight target selection |
| **Support roaming** | Shield/Compass/ArrowUpRight | `Lane` / `RoamMid` / `RoamTop` | Support map movement |

### Defaults

```typescript
const DEFAULT_LOL_TACTICS = {
  strong_side: "Bot",
  game_timing: "Mid",
  jungle_style: "Enabler",
  jungle_pathing: "TopToBot",
  fight_plan: "FrontToBack",
  support_roaming: "Lane",
};
```

---

## Role modifiers

Each choice adds or subtracts points from the 5 roles (TOP / JUNGLE / MID /
ADC / SUPPORT). Computed by `computeRoleModifiers()` in `src/lib/teams/lolTactics.ts`.

### Full modifier table

| Tactic choice | Buffs | Nerfs |
|---|---|---|
| **strong_side = Top** | TOP +2 | ADC -1 |
| **strong_side = Mid** | MID +2 | TOP -1 |
| **strong_side = Bot** | ADC +2, SUPPORT +1 | TOP -1 |
| **jungle_pathing = TopToBot** | ADC +1, SUPPORT +1 | TOP -1 |
| **jungle_pathing = BotToTop** | TOP +1, JUNGLE +1 | ADC -1 |
| **jungle_style = Ganker** | JUNGLE +1, strong_side role +1 | — |
| **jungle_style = Invader** | JUNGLE +1, SUPPORT +1 | — |
| **jungle_style = Farmer** | JUNGLE +2 | TOP -0.5 |
| **jungle_style = Enabler** | SUPPORT +1, ADC +1 | — |
| **game_timing = Early** | JUNGLE +1, MID +1 | — |
| **game_timing = Late** | ADC +1, SUPPORT +1 | — |
| **game_timing = Mid** | MID +0.5 | — |
| **fight_plan = FrontToBack** | TOP +1, ADC +1, SUPPORT +1 | MID -0.5 |
| **fight_plan = Pick** | MID +1, JUNGLE +1, SUPPORT +0.5 | TOP -0.5 |
| **fight_plan = Dive** | TOP +1, JUNGLE +1, MID +1 | ADC -1 |
| **fight_plan = Siege** | MID +1, ADC +1, SUPPORT +0.5 | TOP -0.5 |
| **support_roaming = Lane** | SUPPORT +0.75, ADC +0.75 | — |
| **support_roaming = RoamMid** | MID +1.5 | SUPPORT -0.75, TOP -0.25 |
| **support_roaming = RoamTop** | TOP +1.5 | SUPPORT -1, ADC -0.5 |

Modifiers are **scaled by 1.8x** in the UI display and draft simulator.

---

## Coherence

Coherence measures **internal synergy** between tactic choices. Computed by
`computeCoherenceBreakdown()` in `lolTactics.ts`. Range: approximately -2.0 to +2.0.

### Checks

| Check | Condition | Positive | Negative |
|---|---|---|---|
| **Jungle path ↔ strong side** | strong_side = Bot | TopToBot = +0.5 | BotToTop = -0.5 |
| | strong_side = Mid | always +0.25 | — |
| | strong_side = Top | BotToTop = +0.5 | TopToBot = -0.5 |
| **Timing ↔ jungle style** | Early | Ganker/Invader = +0.5 | Farmer/Enabler = -0.5 |
| | Late | Farmer/Enabler = +0.5 | Ganker/Invader = -0.5 |
| | Mid | always +0.25 | — |
| **Fight plan ↔ jungle style** | Pick | Ganker/Invader = +0.5 | — |
| | FrontToBack | Bot strong = +0.5, else +0.25 | — |
| | other | always +0.25 | — |
| **Support roam ↔ strong side** | Lane | Bot strong = +0.5 | — |
| | RoamMid | Mid strong = +0.5, else +0.1 | — |
| | RoamTop | Top strong = +0.5 | — |

The total coherence score is displayed as an SVG ring (0-100% mapped from -2/+2)
and a breakdown list.

### Impact

In the draft simulator (`draftResultSimulator.ts`):
```
score += coherenceScore * 2.2
```

---

## Impact on live match (Rust)

### Combat stats

In `sim_live.rs:1241-1339`, role modifiers are applied to each champion:

```rust
max_hp *= (1.0 + tuned_role_modifier * 0.012)
attack_damage *= (1.0 + tuned_role_modifier * 0.016)
move_speed += tuned_role_modifier * 0.00035
```

Jungle modifiers are dampened by **0.65x** before application.

### Macro AI

| Tactic | Effect in `macro_ai.rs` |
|---|---|
| **game_timing** | Early = path to objectives 50s before spawn. Late = 22s. Mid = 35s |
| **strong_side** | Reorders objective priority (Herald > Grubs > Dragon depending on lane) |
| **jungle_style** | Farmer = prioritize camps. Invader = hard invade. Ganker = gank lanes |
| **jungle_pathing** | Determines jungle start position (top buff vs bot buff) |
| **support_roaming** | RoamMid = support paths mid. RoamTop = paths top. Lane = stays bot |
| **fight_plan** | Dive = tower dive HP threshold -8%. Siege = no dive if enemy HP > 45%. FrontToBack = threshold +4% |

---

## Frontend

### Component hierarchy

```
TacticsTabV2 (v2)
├── 6 Section<T> cards (selector grid)
│   ├── StrongSideSection
│   ├── GameTimingSection
│   ├── JungleStyleSection
│   ├── JunglePathingSection
│   ├── FightPlanSection
│   └── SupportRoamingSection
│
└── Sidebar (sticky right)
    ├── CoherenceRing (SVG donut)
    ├── CoherenceBreakdown (labels + deltas)
    └── RoleImpactCards (5 positions)
        ├── Player photo + name
        ├── Base OVR
        ├── Modifier bar (+/- from center)
        └── Variance indicator
```

### Persistence

On every selection change:
```typescript
await invoke("set_lol_tactics", { lolTactics: newTactics })
// Returns updated GameState → zustand setGameState
```

The Rust command finds the manager's team and replaces `team.lol_tactics`:

```rust
#[tauri::command]
pub fn set_lol_tactics(state, lol_tactics: LolTactics) -> Result<Game, String> {
    let mut game = state.get_game(|g| g.clone())?;
    let team_id = game.manager.team_id?;
    game.teams.iter_mut().find(|t| t.id == team_id)
        .unwrap().lol_tactics = lol_tactics;
    state.set_game(game.clone());
    Ok(game)
}
```

---

## Data model

### TypeScript

```typescript
interface LolTacticsData {
  strong_side: "Top" | "Mid" | "Bot";
  game_timing: "Early" | "Mid" | "Late";
  jungle_style: "Ganker" | "Invader" | "Farmer" | "Enabler";
  jungle_pathing: "TopToBot" | "BotToTop";
  fight_plan: "FrontToBack" | "Pick" | "Dive" | "Siege";
  support_roaming: "Lane" | "RoamMid" | "RoamTop";
}
```

Lives inside `TeamData.lol_tactics?: LolTacticsData`.

### Rust

```rust
pub struct LolTactics {
    pub strong_side: StrongSide,        // Top | Mid | Bot
    pub game_timing: GameTiming,        // Early | Mid | Late
    pub jungle_style: JungleStyle,      // Ganker | Invader | Farmer | Carry | Enabler
    pub jungle_pathing: JunglePathing,  // TopToBot | BotToTop
    pub fight_plan: FightPlan,          // FrontToBack | Pick | Dive | Siege | Flank
    pub support_roaming: SupportRoaming,// Lane | RoamMid | RoamTop
}
```

Note: Rust has extra variants (`Carry`, `Flank`) not exposed in the frontend.

---

## Key files

| File | Role |
|---|---|
| `src/ui-v2/dashboard/tabs/TacticsTabV2.tsx` | v2 UI (779 lines) |
| `src/components/tactics/TacticsTab.tsx` | Legacy UI (745 lines) |
| `src/components/tactics/TacticsTab.helpers.ts` | Starting XI helpers (not LoL-specific) |
| `src/lib/teams/lolTactics.ts` | **Core engine**: modifiers + coherence (173 lines) |
| `src/store/types.ts` (L125-132) | `LolTacticsData` TS type |
| `src/components/match/draftResultSimulator.ts` | Uses modifiers + coherence for score prediction |
| `src-tauri/crates/olm_core/src/domain/team.rs` (L199-279) | Rust `LolTactics` + all enums |
| `src-tauri/src/commands/squad.rs` (L547-568) | Tauri command handler |
| `src-tauri/crates/olm_core/src/commands.rs` (L72-76) | Game engine command |
| `src-tauri/crates/olm_core/src/sim_live.rs` (L289-381) | `RuntimeTeamTactics` |
| `src-tauri/crates/olm_core/src/sim_live/state_init.rs` (L148-179) | Injects tactics into match runtime |
| `src-tauri/crates/olm_core/src/sim_live/combat.rs` (L460-461, L5044-5249) | Fight plan AI |
| `src-tauri/crates/olm_core/src/sim_live/macro_ai.rs` (L442-752, L1401-1504) | Macro AI behavior |
| `src-tauri/crates/olm_core/src/db/repositories/team_repo.rs` (L229) | Default on DB load |
