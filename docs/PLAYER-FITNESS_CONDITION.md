# Player Fitness & Condition

## Overview

OLManager tracks two related stamina systems for every player: **Condition** (short-term energy) and **Fitness** (long-term physical shape).

| Stat | Range | Default | Changes | UI visibility |
|------|-------|---------|---------|---------------|
| Condition | 0-100 | 100 | Fast — per match & per day | ✅ Everywhere |
| Fitness | 0-100 | 75 | Slow — probabilistic | ✅ Added Oct 2025 |

---

## Condition

### What it represents

Short-term match readiness. Depletes during matches and training, recovers daily.

### Depletion

**After a match** (`turn/post_match.rs`, `deplete_match_stamina`):

```
base_depletion = 15 * (1 - mental_resilience/100 * 0.25)
depletion = ceil(base_depletion * (minutes_played / 90))
```

A full 90-min match depletes 11–15 condition depending on mental resilience, and
even a one-minute stint costs at least one point. (An earlier build used a base
of 40, which sent every team to zero condition by mid-split.)

**Training** (`training.rs:951-961`):

| Intensity | Cost |
|-----------|------|
| Low | 3 |
| Medium | 6 |
| High | 10 |
| Rest day / Recovery focus | 0 |

### Recovery (daily)

On rest days, base recovery = `9.0 × physio_bonus × facility_mult`.

On **matchdays** every player (whether or not they played) also recovers 60 % of
a rest day (`training::process_matchday_recovery`, base `5.4`). Matchdays never
train and never cost condition, they only give back some energy, so a team that
plays three days in a row no longer drains to zero. This is ported from upstream
OLManager PR #325.

Multiplied by:

| Factor | Range |
|--------|-------|
| Mental resilience | 0.5× – 1.0× |
| Age | 0.70× (≥34) – 1.10× (≤21) |
| Morale | 0.90× (<40) – 1.10× (≥70) |
| Current condition | 0.80× (<30) – 1.00× (≥50) |
| Fitness | 0.75× (<30) – 1.20× (≥90) |

Training days use a lower base (5.0×). Recovery focus days use 9.0×.

### AI teams rest tired players (`ai_rotation.rs`)

The user manages their own team's lineup and training; rival teams follow a
simple rule so they do not play the whole split on empty. All values are
`[PLACEHOLDER]` until playtested.

| Rule | Threshold |
|------|-----------|
| A starter rests when a same-role substitute is available | starter condition < 40, substitute condition >= 55 and fresher |
| A rested player returns to the lineup | condition >= 70 and better OVR than the current starter |
| Fatigued players skip training and take a rest day instead (no substitute needed) | condition < 45 |
| Import limit | a swap never leaves more than 2 imports in the starting five |

The 40 / 70 gap is a hysteresis so a pair does not swap every day. The lineup is
re-evaluated once a day after recovery (`turn::process_day`,
`turn::finish_live_match_day`), so the user's rival is already rested when the
match starts. Swaps are same-role only, so lane order never changes. Teams
without a substitute for a role keep their starter, and rely on the training
rest above. Old saves need nothing: no stored state, the rule reads the current
lineup and conditions.

Simulation (`tests/ai_condition_sim_tests.rs`: eight teams, three matchdays a
week, ten weeks), rival starters' condition:

| Roster | Before | After |
|--------|--------|-------|
| 5 starters, no substitute | mean 19.4, last week 5.5, lowest 0 | mean 57.5, last week 53.8, lowest 27 |
| plus 1 substitute | mean 19.4, last week 5.5, lowest 0 | mean 58.5, last week 54.6, lowest 28 |
| plus 2 substitutes | mean 19.3, last week 5.5, lowest 0 | mean 63.5, last week 63.2, lowest 28 |

### ⚠️ Condition does NOT affect match performance

The engine never reads `player.condition` during live simulation. A player with `condition = 1` plays identically to `condition = 100`. The `effective_overall()` method that would multiply OVR by `condition / 100` was removed as dead code (Oct 2025).

**This is the single biggest gameplay gap.** It means there is no strategic cost to running the same 5 players every match without rest.

---

## Fitness

### What it represents

Long-term physical shape. Changes slowly over weeks. Acts as a multiplier for condition recovery.

### What changes fitness

| Action | Effect | Source |
|--------|--------|--------|
| Play ≥60 min in a match | 30% chance +1 | `post_match.rs:832-838` |
| Training (Scrims focus) | 1.2% chance +1 per session | `training.rs:1160-1191` |
| Training (Recovery focus) | 5% chance +1 per session | `training.rs:1160-1191` |
| Fitness > 85 + normal training | 5% chance −1 per session | `training.rs:1160-1191` |

### How fitness affects the game

Only through condition recovery multipliers (see above). A player with `fitness = 90` recovers 20% faster than a player with `fitness = 50`.

### UI

Fitness is displayed alongside condition in:

- **Squad roster** — green bar column
- **Player profile hero card** — QuickStat
- **Player profile contract card** — InfoRow with bar
- **Home roster lineup card** — mini-card in 3-column grid
- **Draft result screen** — mapped from backend data

---

## Known issues

| # | Issue | Status |
|---|-------|--------|
| 1 | Condition has no effect on match simulation | 🔴 Not implemented |
| 2 | Fitness is optional in the TypeScript type (should be required) | ✅ Optional (Oct 2025) |

## Future considerations

- **In-match fatigue**: The `fatigue_per_minute` field in `MatchConfig` was defined but never wired in. Removed as dead code (Oct 2025). Could be re-implemented if in-match condition drain is desired.
- **Training intensity vs match performance**: Players arriving exhausted from high-intensity training have no gameplay penalty — only cosmetic.
