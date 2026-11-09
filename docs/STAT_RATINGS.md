# Stat-derived player ratings

New games rate about 780 players from real pro statistics instead of the original authored numbers. This page
explains the method, its limits and how to refresh the data. Data: Leaguepedia (lol.fandom.com), CC BY-SA 3.0.

**Quick path to refresh:** [Refresh procedure](#refresh-procedure).

## The problem

- A player's OVR is the rounded mean of 9 attributes. The attributes come from the upstream data import and
  have no documented method.
- Example: Boal (Top, paiN Gaming) had OVR 50 while the CBLOL median is 75.
- League explains 86% of OVR variance, and one skill number explains 95% of the attribute variance.

## The data

| Item | Value |
|------|-------|
| Source | Leaguepedia Cargo tables `ScoreboardPlayers` joined to `ScoreboardGames` |
| Window | 2025-01-01 to 2026-11-10 |
| Scope | 28 competitions (`scripts/stats/prefix-map.json`) |
| Size | 159,140 per-game rows |

## The model in plain words

1. **Role-relative z-scores.** Each game row is compared with players of the same role in the same cohort
   (KDA, kill participation, damage share, CS per minute, gold share, deaths inverted). One skill z per player.
2. **Reliability shrinkage.** The z is pulled toward 0 by split-half reliability (Spearman-Brown), with an
   8-game floor. Few games means a small move.
3. **Fixed league ladder.** League levels stay as authored (median OVR per competition: LCK 85, LEC 80, CBLOL 75,
   LES 71...). Stats only place a player inside his league: `league median + league sd (3 to 5) x shrunk z`.
4. **Trust blend.** The final rating blends the authored value and the stat estimate, with trust up to 0.9.
5. **Suspect rows.** Authored rows that look like placeholders (jittered around 50, or far below the league
   median) get lower trust, so Boal-like rows move a lot and normal players move a few points.
6. **`skill_carry`.** Shotcalling, discipline and mental resilience have no stat. They keep their authored value
   plus 0.75 x the mean shift of the measured attributes.

## Rules for league movers and caps

| Rule | Why |
|------|-----|
| A player whose stat league differs from his game league keeps his authored rating. | Neither anchor is reliable. The game anchor sent Sharvel 74 to 90 in the LCK. The stat anchor sent re0 86 to 69, because the LDL level rests on 16 rows. |
| A suspect mover gets the mean of both anchors. | A flat-50 row has nothing better to keep. |
| Non-suspect changes are capped at 6 points. | Limits damage from noisy stats. |
| Suspect rows are not capped. | They are the rows the method exists to fix. |

## Results

- 1,162 of 1,906 game players matched to a Leaguepedia player; 947 estimated; 781 asset entries.
- Boal 50 to 74, Minous 50 to 72, Winner 74 to 75. League order is unchanged and the spread inside leagues
  shrinks (LEC 3.1 to 1.5).

| Authored OVR band | Mean change |
|-------------------|-------------|
| under 70 | +0.85 |
| 70-79 | +0.59 |
| 80-84 | +0.32 |
| 85-89 | -0.61 |
| 90+ | -2.21 |

**Top-star effect.** The best players move down on average (Faker 91 to 85, Gumayusi 91 to 86, Xiaohu 91 to 85),
though some move up (Chovy 90 to 95, Kiin 90 to 93). Derived market values and seeded wages follow the new
OVR, so top stars get cheaper. Whether to protect them is an open product question.

## Known limits

- Box-score stats ignore shotcalling and team context. A strong team lifts its players' numbers.
- The LDL level rests on 16 real rows (37 excluded as placeholders).
- Support is the most upward role (mean +1.16), a tilt of the role cohorts.
- Stale rows (last game 17 months ago) still move fully.
- Falling veterans keep their high `potential_base`.
- 143 unlisted placeholder players drift up to 2 OVR, because their estimate uses the new league medians.
- Identity matching is by name and team. 568 candidates sit in the review list of the report.

## What the game does with the asset

- The asset is `assets/world/player-rating-overrides.json`, loaded by `olm_core::player_rating_overrides`.
- **New games only.** Existing saves are untouched.
- **`authored_ovr` guard.** Each entry stores the OVR it was computed from. If the player's authored OVR
  differs, the entry is skipped and reported as stale.
- The pass runs after the catalog corrections and before the placeholder estimate, and again for players added
  by the roster overlay.
- It sets the attributes and `lol_ovr`, and floors `potential_base` at the new OVR.
- **Market value** is recomputed only when it is 0, 15 x wage, or the old seed value.
- **Wages stay authored.** Wages seeded for wage-0 players follow the new OVR.

## Refresh procedure

```bash
# 1. Fetch (live; needs explicit authorization and the bot login)
npm run stats:fetch -- --login --until 2026-11-10

# 2. Build the asset and the report (offline, deterministic)
npm run stats:build
```

- Cache: `src-tauri/target/olm-scratch/lp-stats-cache` (30-day expiry). Nothing is written to `--out` until every
  competition is complete.
- **Resume after the 450-request cap:** run the same command again. Cached pages cost no request. Use a fresh
  `--cache-dir` when new games were played since the cache was filled.
- `--login` uses a MediaWiki bot password stored outside the repository (see `scripts/champions/README.md`).
- Flags and the build steps are in `scripts/stats/README.md`.

**Review `report.md` before committing a new asset:**

- [ ] Totals: matched, estimated and entry counts are close to the previous run.
- [ ] League levels: `n used` is plausible for each competition.
- [ ] Mean change by band and by role: no new tilt.
- [ ] Spotlight, top risers and fallers, capped list: each name is credible.
- [ ] Suspect rows and movers: nobody moves to a level they do not play at.
- [ ] Review list and unmatched links: add pins to `scripts/stats/pins.json` where needed.

**Tests that must pass:**

```bash
npx vitest run src/lib/stats
cd src-tauri && cargo test -p olm_core
cd src-tauri && cargo test -p openleaguemanager --lib commands::game
```

In `src-tauri/src/commands/game.rs` the real-world tests are `the_bundled_rating_overrides_land_on_a_real_new_world`,
`a_bundled_entry_sets_the_ratings_of_its_player_in_a_new_world`,
`unlisted_players_keep_their_ratings_and_every_wage_stays_in_a_new_world` and
`potential_covers_the_rating_of_every_player_the_bundled_overrides_rated`. They fail when an entry goes stale or
a wage changes.

## Rate-limit findings

Observed on 2026-11-09. No quota is published (`Help:Leaguepedia_API` was unreachable).

- The bot login does not remove the Cargo rate limit. It lets 500-row pages through.
- Pace: about 4 pages a minute at a 4 s throttle.
- About a third of the requests were retried with `api:ratelimited`.
- 450 requests fetched 302 pages.
- Cached pages cost nothing.

## Attribution and license

Leaguepedia content is licensed CC BY-SA 3.0. The README and the Settings "About" tab credit it.

**Open question for the owner:** whether ShareAlike applies to the derived asset (numbers computed from the
statistics) has not been decided.
