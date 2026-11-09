# Per-game pro stats (stat-derived ratings)

`pro-stats.mjs` downloads per-game player rows from Leaguepedia (Cargo tables `ScoreboardPlayers` joined to
`ScoreboardGames`) and normalizes them into the input of the skill model (`lib/skill.mjs`).

Data: Leaguepedia (lol.fandom.com), CC BY-SA 3.0.

```bash
node scripts/stats/pro-stats.mjs --offline                     # cache only; fails on a miss
node scripts/stats/pro-stats.mjs --login --competitions lck,lec  # live run: needs the user's authorization
npm run stats:fetch -- --help
```

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--since YYYY-MM-DD` | `2025-01-01` | first game date |
| `--until YYYY-MM-DD` | tomorrow (UTC), at most `2027-01-01` | end date, exclusive |
| `--competitions <ids>` | all mapped | comma-separated OLManager competition ids from `prefix-map.json` |
| `--offline` | off | read the cache only; a miss fails with the request that was missing |
| `--login` | off | log in with the Leaguepedia bot password (see `scripts/champions/README.md`, "Logging in") |
| `--cache-dir <dir>` | `src-tauri/target/olm-scratch/lp-stats-cache` | HTTP cache (separate from `lp-cargo-cache`) |
| `--out <file>` | `src-tauri/target/olm-scratch/stat-ratings/rows.json` | normalized rows |
| `--max-requests <n>` | `450` | cap on live requests |
| `--page-size <n>` | `500` | Cargo page size (1 to 5000; above 500 needs `--login`, because Cargo caps pages at 500 without high limits) |

Next to `--out` it writes `<name>.coverage.json`: per competition the games, kept rows, players, input rows and
dropped rows by reason, plus the `open` list and the network stats.

It also writes `<name>.players.json` (`{ source, since, until, players }`): per Leaguepedia `Link` the in-game names
seen, the teams (`team`, `competition`, `games`, `lastDate`; newest first), games per role, total games and first and
last date. It is built from the rows that survive validation, so `games` equals that player's rows in `<name>.json`.
`build-overrides.mjs` uses it to match Leaguepedia players to game players.

## How it works

- One query per page: `ScoreboardPlayers=SP` joined to `ScoreboardGames=SG` on `GameId`, filtered by the date window
  and one competition's `OverviewPage` prefixes (OR of `LIKE 'prefix%'`). Prefixes are validated (letters, digits,
  spaces and `/ . _ - '`) and single quotes are doubled.
- Pages are ordered by `SP.GameId, SP.Side, SP.Role, SP.Name`. `SP.GameRoleId` is not used because its uniqueness per
  row is unverified. The run goes competition by competition, page by page, and stops at the first page shorter than
  the page size.
- Paging is by offset and a page shorter than `--page-size` ends a competition, so the page size must not exceed
  the server cap (500 without `--login`; the script refuses a larger value without it).
- Every page is cached (30 days), so a rerun after a failure or a request-cap stop resumes from the cache. Nothing is
  written to `--out` until every selected competition is complete. Offsets shift when a new game sorts into the
  middle of the `GameId` order, so pages cached on different days can skip or repeat rows. When new games have been
  played since the cache was filled (ongoing competitions), rerun with a fresh `--cache-dir`. A high count of
  "team without exactly 5 rows" drops is the symptom. The default `--until` stops at tomorrow to limit this.
- There is no team-damage field, so `teamDamageToChampions` is summed over the 5 rows of the same team and game.
  A team without exactly 5 rows, or with a missing damage value, is dropped whole.
- Rows are dropped, and counted by reason, for: duplicate row, team without exactly 5 rows, team damage incomplete,
  bad role (only Top, Jungle, Mid, Bot, Support), bad date (strict `YYYY-MM-DD`, so `2024-13-45` is rejected),
  missing minutes, missing player link, missing stat.
- `playerKey` is the Leaguepedia `Link`. Output order is deterministic.

## Prefix map

`prefix-map.json` maps competition ids to `OverviewPage` prefixes. Prefixes end with `/` so `LPL/` never matches
`LPLOL/`. Names that are not confirmed stay out of `competitions` and are listed under `open` with a reason: LCK
Academy Series (vs LCK CL), the Equal Esports Cup and TransIP Road Of Legends. The map is inferred from tournament
names. Three 2025 predecessors were confirmed by the user and are listed under `confirmed`: Superliga Domino's (LES),
LTA North (LCS) and LTA South (CBLOL; in 2025 it also held LLA teams).

## Request forecast

About 333 pages for the covered competitions in 2025-2026. At about 12 s per page (4 s throttle plus retries) that
is about 70 minutes. The default cap of 450 requests leaves room for retries. The run is resumable.

The live run needs `--login`: anonymous Cargo queries were rate-limited on the first request. It also needs the
user's explicit authorization (destination, operation and credential). Tests use fake clients only.

## Building the overrides asset

`npm run stats:build` (`scripts/stats/build-overrides.mjs`) turns the rows, the player index and the game world into
`assets/world/player-rating-overrides.json` plus `report.md` and `report.json` (default
`src-tauri/target/olm-scratch/stat-ratings`). It is offline and deterministic.

1. **Game players** (`lib/game-world.mjs`): `data/` through `scripts/world/lib/world.mjs` (catalog corrections,
   effective team ids, free agents) plus the roster overlay (moves, retirements, adds, same rules as
   `apply_world_overlay`). Not reproduced from the Rust assembly: ERL academy bootstrap, short-roster fills,
   `scrub_departed_players`, placeholder estimation (flat-50 rows are only flagged) and contract or market-value
   defaults.
2. **League ladder** (`lib/levels.mjs`): per competition, median and sd of the authored OVR of rostered players,
   without flat-50 and all-zero rows. Fixed; stats never move it.
3. **Identity** (`lib/identity.mjs`): a Link matches a game player when the compact IGN (Link without parenthetical,
   or any seen name) equals his `match_name` and either his latest Leaguepedia team maps to his team through
   `scripts/world/team-map.json`, or his main role (ADC is Bot) and latest competition equal the player's, and the
   pairing is unique on both sides. Anything else with an IGN candidate goes to the review list. `pins.json`
   (`{ "<Link>": "<player id>" | null }`, committed empty) forces a match or, with `null`, forbids one; a pin that
   points nowhere is reported and its link stays out.
4. **Estimate**: `estimateSkill` over all rows. Fallback cohorts pool the competitions whose level falls in the same
   5-point bucket. A matched player takes the cohort with the most effective games; the target is the fixed level of
   that competition (`blendRating`), with the suspect rule applied to his authored row against the median of his
   current competition. Players whose stat competition differs from their game competition are flagged.
5. **Attributes** (`lib/attributes.mjs`): mechanics, laning and teamfighting take the full OVR delta; macro_play,
   consistency and champion_pool do too from 25 raw games on. The others follow with `skill_carry` 0.75 x delta. A
   rounding correction (measured attributes first) makes `round(mean of 9)` equal `round(finalOvr)` exactly.
   `potential_floor` is the larger of the new OVR and the authored `potential_base`.
6. Only matched players with an estimate and changed attributes get an entry. Flat-50 and all-zero rows are skipped
   (the game estimates them itself); `--include-placeholders` writes entries for them too, blended from their league
   median as suspect rows.

The report lists per competition the players, matches, estimates and mean and max |delta|, the crossings of OVR 65,
70 and 80, the top 25 risers and fallers, every suspect row, the review list, the unmatched links with the most games
and explicit rows for Boal, Minous and Winner. Data: Leaguepedia, CC BY-SA 3.0.

## Outputs

The cache, rows and coverage stay under `src-tauri/target/olm-scratch` (gitignored). Never commit them.
Tests: `npx vitest run src/lib/stats`.
