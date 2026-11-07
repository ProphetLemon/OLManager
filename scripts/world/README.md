# World roster refresh (maintainer tool)

Builds `assets/world/roster-overlay.json`: the changes (moves, retirements, new players and staff) that bring the bundled
`data/` world up to date with Leaguepedia. **The shipped game never scrapes.** It only reads the reviewed overlay.

```bash
# 1. Map game teams to Leaguepedia pages (once, then review and commit scripts/world/team-map.json)
npm run world:refresh -- --build-team-map

# 2. Refresh. First run is slow (about 4 s per request); everything is cached in scripts/world/.cache/
npm run world:refresh

# Smaller / offline runs
npm run world:refresh -- --competitions lck,lec --dry-run --out /tmp/overlay.json
npm run world:refresh -- --offline --competitions lck,lec          # cache only, fails clearly on a miss

# 3. Validate the committed overlay against data/ (not part of dev/build)
npm run verify:world-overlay [-- path/to/overlay.json [path/to/data]]
```

Flags: `--competitions a,b` `--offline` `--cache-dir` `--throttle-ms` (4000) `--max-requests` (3000) `--max-cache-age-days` (7) `--as-of`
`--out` `--report` (default `scripts/world/out/report.md`) `--build-team-map` `--allow-gate-failures` `--dry-run`
(writes the overlay only when `--out` is given) `--gate-exceptions` (default `scripts/world/gate-exceptions.json`)
`--data-dir` `--team-map` `--id-map`.

Live runs re-fetch cache entries older than `--max-cache-age-days`; offline runs read any age. `as_of` defaults to the
fetch date of the oldest cache entry used (an explicit `--as-of` wins, with a warning when it is newer than that).
Name-only and IGN-only matches produce no operation: they appear under "Needs review" in the report until
`id-map.json` pins them or both sides know the same date of birth. A run whose licence is the offline placeholder
fails the `license-available` gate.

## Review before committing

Read `scripts/world/out/report.md`. For every competition it lists the team mapping, matched/new/ambiguous/refused counts,
each operation with its evidence page, skipped items, gate results and the duplicate ids inside the bundled world.
Fix problems in the reviewed inputs, not in the overlay:

- `team-map.json`: game team id -> Leaguepedia page title. `null` plus a reason means unmapped; those teams are skipped,
  never guessed. Mark a hand-edited entry `"manual": true` so `--build-team-map` keeps it.
- `id-map.json`: pin a Leaguepedia page to a game id, or reject a pair ("these are not the same person").
  Needed for people the matcher refuses (conflicting real names, duplicate records with identical IGN and name).

Gates (a failed gate exits non-zero and the overlay is not written unless `--allow-gate-failures`): schema and references
valid, no id used twice, no team left under its floor by a release, at most 8 new players per team, at most 60% of a
competition's players moved or retired unless it has a reviewed exception.

- **Roster floor.** `floor(team) = min(5, the team's starting player count in the bundled world)`. In the off-season
  Leaguepedia rosters are empty or partial, but the game starts on 1 January with playable rosters. After the operations
  are built, every team that would end under its floor keeps all of its players that the overlay would release (a `move`
  with `team_id: null`). Those releases are dropped and listed in the report under "Skipped and ambiguous" as
  `kept-for-roster-floor` (team, would-be count, floor). Moves to other teams, retirements and additions are never dropped.
- **`min-roster` gate.** Fails only when a team ends under its floor and a release out of it is still in the overlay. Teams
  short only through confirmed moves/retirements pass and are listed in the gate detail ("short only through confirmed
  moves/retirements; the game fills them from free agents at new game").
- **`max-changed-share` exceptions.** `scripts/world/gate-exceptions.json`
  (`{"maxChangedShare": {"<competitionId>": {"reason": "...", "reviewed": "YYYY-MM-DD"}}}`; override with
  `--gate-exceptions`; a missing file means none; an entry without `reason` or `reviewed` is rejected). Add one only after
  reading the competition's operations in the report: moves matched on strong/ign+name, releases backed by player pages,
  retirements from the infobox, and no wrong team mapping (a wrong mapping is fixed in `team-map.json`, never exempted).
  A listed competition passes with `reviewed exception: <reason>` in the gate detail.

## What the tool does and does not decide

- Coverage is every competition the game loads players for (`legacy` is false, players shard exists), minus the stale
  duplicates `lck-cl` and `prime_league` (copies of `lckcl`/`prm` with other team ids).
- Team ids are the in-game ids (`<competition>-<shard id>`, as `assemble_world_from_modular_data` builds them).
- Only roles `Top Laner ... Support` and `Sub/*` count as the roster. `Trn/*` (trainee) and `IA/*` (inactive) entries only
  mark a person as seen. A person absent from every roster is looked up: retired (page says so) -> `retire`; "previously" or a
  team outside the game world -> free agent; anything else -> no operation.
- Staff: owners are never touched; roles never change into or away from Assistant; added staff get `HeadCoach`,
  `Performance Coach`, `Analyst` or `Scout`; staff are moved only when matched on another team, never released for being
  absent from a table.
- New players/staff get deterministic ids (`sha256("leaguepedia:" + page title)`, first 8 hex), attributes from the
  competition's per-position medians with seeded jitter (+-4), and `dob_approx: true` on the op when the infobox has no birth date.
- The same input produces byte-identical output.

## Licence and attribution

Leaguepedia text is available under the licence reported by `api.php?action=query&meta=siteinfo&siprop=rightsinfo`
(CC BY-SA 3.0, https://www.fandom.com/licensing when this was written). The tool records that licence, a statement crediting
Leaguepedia contributors and the page URL pattern in the overlay's `source`, and every operation carries the page it came from.
Keep that attribution wherever the overlay data is surfaced.

## Etiquette

- Plain `api.php` only (Cargo is blocked and rate limited). Never script around Cloudflare.
- User-Agent is exactly `OLManager-research/0.1 (roster refresh tool)`. Do not add emails, names or other personal data.
- 4 s between live requests, `maxlag=5`, bounded retries with backoff on 429/5xx. Reuse the cache; do not delete it between runs.
- Do not run it in CI or on a schedule without agreeing that with the wiki operators first.
- `--max-requests` is a hard cap on live requests; a run stops with an error when it is exhausted.

## Tests

`npx vitest run src/lib/world` uses recorded responses in `scripts/world/fixtures/cache` (keys are
`sha1` of the sorted request parameters, same as the original Python spike) and a small LCK/LEC world in
`scripts/world/fixtures/data`. Tests never touch the network.
