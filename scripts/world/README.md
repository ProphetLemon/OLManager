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
`--data-dir` `--team-map` `--id-map` `--pool` `--pool-since` `--pool-cap` `--pool-probe` (see "Adding the active-pros pool").

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
competition's players moved or retired unless it has a reviewed exception, and nobody both a player and a staff member.

- **`no-player-staff-twins` gate.** After the operations, no player and staff member of the new world may be one person:
  ids made from the same page (the same 8-hex page hash), the same page title of this run (case and spacing aside), or a
  shared folded name and the same real birth date (placeholders and `dob_approx` dates do not count). A player-coach
  Leaguepedia lists in both tables of one team is allowed through `DUAL_ROLES` in `lib/gates.mjs`, with the evidence in a
  comment, and through `dual_roles` in `src-tauri/src/world_identity_review.json` (the app's identity test runs the same check).
  `src/lib/world/overlay-ship-twins.test.ts` runs it on the shipped overlay.

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
- The loaded world matches what the game assembles: duplicate player ids keep the live competition's record, players on
  teams that do not exist are free agents, and the reviewed field fixes in `assets/world/catalog-corrections.json`
  (`{"corrections": [{id, field, from, to, evidence}]}`, fields `full_name`/`match_name`/`nationality`) are applied. An entry
  with an unknown id or a `from` that no longer matches is skipped, never an error. The game applies the same file in
  `olm_core::world_catalog`; add an entry only with evidence (e.g. a Leaguepedia page in the offline cache).
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

## Filling empty nationalities (`nationality-corrections.mjs`)

Some bundled players have no nationality, so they show no flag and a teamless one never counts as an import. The tool turns
a join between those players and Leaguepedia's `Players` table into `nationality` entries (`from: ""`, ISO-2 `to`) of
`assets/world/catalog-corrections.json`. **It makes no network request**: it reads a join that was queried once, by hand
(`--rows` the Cargo `Players` rows with `ID`, `Name`, `Country`; `--detail` one `[tier, id, in-game name, real name, country,
rows with that ID]` per player).

```bash
node scripts/world/nationality-corrections.mjs --rows lp-cargo-rows.json --detail lp-join-detail.json \
  [--data-dir data] [--out assets/world/catalog-corrections.json] [--queried 2026-11-16] [--list review.md]
```

- Only the two name-confirmed tiers write an entry: `A` (one row with that in-game name, real name agrees) and `A2` (several
  rows share the name, exactly one agrees on the real name). Weaker tiers stay empty on purpose.
- An id the shipped data lacks, a player that already has a nationality, or a country with no ISO-2 code is skipped and
  printed, never written. Existing entries are kept (also another field of the same player) and the output is sorted by id.
- `United Kingdom` becomes `GB`. The evidence is the Leaguepedia page of the row's `ID`; an `A2` page can be a disambiguation
  page when several people share the ID, so skim the `--list` table before committing.
- The same input gives byte-identical output. `src/lib/world/nationality-corrections.test.ts` covers it, including a check that
  every bundled correction still applies to `data/`.

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

## Logging in (optional)

`--login` logs in with a Leaguepedia bot password before the first query. Setup steps are in
`scripts/champions/README.md` under "Logging in". It is unverified whether a logged-in account avoids rate limits.

## Tests

`npx vitest run src/lib/world` uses recorded responses in `scripts/world/fixtures/cache` (keys are
`sha1` of the sorted request parameters, same as the original Python spike) and a small LCK/LEC world in
`scripts/world/fixtures/data`. Tests never touch the network.

## Signing the overlay (Ed25519)

The app only accepts a downloaded overlay whose detached Ed25519 signature verifies against the public key compiled into the
app. A tampered, unsigned or wrongly signed overlay is rejected and the app keeps what it had (the bundled overlay at worst).

- **Format.** `assets/world/roster-overlay.json.sig` holds the base64 (standard alphabet, padded, one line) of the 64-byte
  Ed25519 signature over the exact bytes of `roster-overlay.json`. Any edit to the overlay, even whitespace, needs a re-sign.
- **Public key.** `assets/world/overlay-signing-key.pub`: base64 of the raw 32-byte key, committed and embedded in the app.
- **Private key.** PKCS#8 PEM, mode 0600, outside the repo: `$OLM_OVERLAY_SIGNING_KEY` or
  `~/.config/olmanager/overlay-signing-key.pem`. **Back it up** (password manager or offline media). Losing it means shipping
  a new app build with a new public key before any overlay can be downloaded again. Never print, paste or commit it.
- **Create (once).** `npm run world:keygen` creates the key only if none exists, never overwrites, and prints only the public key
  and its SHA-256 fingerprint. Commit the printed public key as `overlay-signing-key.pub` and ship an app build that embeds it.
- **Re-sign.** `npm run world:refresh` signs automatically after writing the overlay when the key is available and prints a
  warning when it is not. To sign by hand (for example after editing the overlay): `npm run world:sign [-- path/to/overlay.json]`.
- **Check.** `npm run verify:world-overlay` also verifies the signature against the committed public key.
- **Schema version.** An overlay with teamless adds (the pool) is emitted as `schemaVersion: 2`; any other overlay stays `1`.
  The app accepts both. Apps released before the pool accept only `1` and reject `2` at parse, so they keep their rosters
  instead of putting pool players on AI teams. `world:sign` and `verify:world-overlay` refuse a version 1 file with teamless
  adds (`teamless_adds_need_schema_v2`): that guard is what stops a mis-emitted file reaching installed apps.
- **Publishing.** The app downloads `<source>` and `<source>.sig` from the fork's `develop` branch. Downloads only succeed once
  the signed overlay and its `.sig` are both on `develop`; until then the app keeps the bundled overlay. Commit the overlay and
  its `.sig` together.

App side: `src-tauri/src/commands/world_overlay.rs` downloads `<source>.sig` with the same https-only, size-capped, timeout rules,
verifies it (`olm_core::world_overlay_signature`) before parsing or caching, stores the signature next to the cache and verifies
the cached pair again on every read. A missing or invalid signature rejects the download, keeps the current cache and never
blocks a new game; a cache without a valid signature is ignored in favour of the bundled overlay. `OLM_WORLD_OVERLAY_SOURCE`
(URL or local path) goes through the same verification against the embedded key, so a local override needs a `.sig` too.
The crypto is `ed25519-dalek` 2.x (BSD-3-Clause, RustCrypto/dalek-cryptography, the de-facto Rust Ed25519 crate; verification
uses `verify_strict`, default features off).

## Measuring the active-pros pool (`pool-scope.mjs`)

Read-only maintainer script that sizes the pool of non-retired people with a roster entry in a league tournament in the
last three years, before any overlay change. It logs in with the bot (`scripts/world/lib/bot-credentials.mjs`), caches every
response in `scripts/world/.cache/pool-scope/` and writes `scripts/world/out/pool-scope/report.{md,json}` (both ignored by git).

```bash
node scripts/world/pool-scope.mjs --data-dir <path to data/> [--since 2023-11-12] [--offline] [--probe Send0o]
```

Three nested tournament filters (pure predicate and Cargo clauses in `lib/pool-scope.mjs`), all excluding showmatches and
cup-qualifier level tournaments, and all limited to leagues (`Tournaments.League`) with at least three tournaments in the window:
`strict` (official: `Tournaments.IsOfficial`, or a `Leagues` row that is an official Primary/Secondary league), `recommended`
(strict plus the non-qualifier tournaments of seasonal leagues, which are the unflagged second divisions) and `loose` (every
non-qualifier tournament of such a league). People already in the game are matched with `lib/match.mjs` and the reviewed
`id-map.json`; people whose current team is in `team-map.json` are left to the roster overlay. Tests: `src/lib/world/pool-scope.test.ts`
with recorded rows in `scripts/world/fixtures/pool-scope/`.

## Adding the active-pros pool (`--pool`)

Opt-in. Without `--pool` the refresh writes exactly what it wrote before (a test pins the bytes). With it, the overlay also
carries `add` operations for **teamless free agents**: the players and staff of the pool measured above, so they can be found and
signed in a new game.

```bash
# Live: the people queries are heavy (about one a minute); run once, keep the cache. Needs the bot login.
npm run world:refresh -- --login --pool --dry-run --out /tmp/overlay.json --report /tmp/report.md
npm run world:refresh -- --offline --pool --pool-cap 60 --pool-probe Send0o      # replays the cache of an earlier live run
```

Flags: `--pool` `--pool-since YYYY-MM-DD` (default 2023-11-12, three years) `--pool-cap n` (default 60) `--pool-probe <page>`
(default `Send0o`; `""` for none) `--pool-stats <rows.json>` (rate from stats, anchored to the game's league levels, see Ratings). Code: `lib/pool-fetch.mjs` (queries), `lib/pool.mjs` (selection, ids, ops), `lib/pool-rating.mjs` (ratings),
`lib/pool-gates.mjs`, `lib/pool-report.mjs`. Tests: `src/lib/world/pool.test.ts`, `pool-rating.test.ts`, `pool-refresh.test.ts` with the recorded rows in
`scripts/world/fixtures/pool/`.

**Who is in.** The `recommended` tournament filter above; people not retired (`Players.IsRetired` 0 or empty) **with a Leaguepedia
Players page** (it is the only source of country, birth date and role); qualifier-flagged tournaments only when they have at most
`--pool-cap` roster entries (promotion stages and closed qualifiers stay, open qualifiers go). The cap leaves a qualifier out
whole; it never keeps "the first 60 names" of one. **Who is out.** Anybody the game has (`lib/match.mjs` plus the reviewed
`id-map.json`), anybody whose current team is in `team-map.json` (the roster overlay handles them), anybody the same run's roster
overlay adds or moves (matched by id, and by page title: Unicode-normalised, case-insensitive, underscores as spaces, so "revenge (X)" in the pool is the "Revenge (X)" the team page adds), players with no usable position, staff whose label is not coaching/analysis/scouting, and anybody the
matcher cannot settle (`ambiguous-with-game`, `duplicate-in-pool`, `id-collision`). Those are listed in the report with the reason.

**Op shape** (the game's `Player`/`Staff` record, `team_id: null`, plus a `pool` object the game ignores; `Bot` becomes `ADC`). The `pool` object is review data: the gates and the report read it in memory, but the file written (`serializeOverlay`) is compact JSON without it, because about 4.7k adds pretty-printed with it come to about 5 MB and the app rejects more than 4 MiB. A roster-only overlay is still 2-space JSON, byte-identical to before. The example below is the in-memory op:

```json
{ "op": "add", "player": { "id": "player-bea33543", "team_id": null, "position": "Top", "nationality": "ES", "full_name": "...",
    "date_of_birth": "2004-02-25", "attributes": { "...": 70 }, "potential_base": 74, "wage": 0, "market_value": 0, "contract_end": "" },
  "evidence": "https://lol.fandom.com/wiki/Send0o", "dob_approx": true,
  "pool": { "page": "Send0o", "kind": "player", "role": "Top", "region": "EMEA", "country": "Spain", "birth_date": null, "tier": 2,
    "best_level": "Secondary", "entries": 11, "last_start": "2026-09-23", "games": 106, "tournaments": 11,
    "leagues": ["..."], "levels": { "Secondary": 11 }, "rating": "tier-default" } }
```

- **Ids** are `player-`/`staff-` + the first 8 hex of `sha256("leaguepedia:" + page title)`, the same function the roster refresh uses, so
  they depend only on the Leaguepedia page: equal across runs and machines, whatever the input order.
- **Ratings** (`lib/pool-rating.mjs`, `lib/pool-anchors.mjs`). `pool.rating` says where the attributes came from. With `--pool-stats` the run also
  builds the game's league ladder the way `npm run stats:build` does (the game data with the committed roster overlay, the reviewed team
  map and pins, the Leaguepedia player index `<rows>.players.json` next to `rows.json`) and anchors the pool to it (method (c) of the A6f
  analysis, no discount for being teamless or inactive: no data supports one):
  - `"stats"` (plus `pool.rating_games`, `pool.rating_competition`): the player has a skill estimate for his own role with at least 8 usable
    games (the skill model's write floor) from a league the game has a level for. The method is the one of `docs/STAT_RATINGS.md`,
    reusing `scripts/stats/lib`: `estimateSkill` gives a role-relative z shrunk by reliability (`rho`), and small leagues borrow the cohort
    of leagues of a similar level (`poolOf`, as `build-overrides.mjs` does); the anchor is the median of `league_levels` for the league
    his stats come from (both the "authored" value and the league median), so a player of a game tier-2 league is rated against that
    league, not against a top flight; `blendRating` with that league's sd (clamped 3..5) gives the final OVR; the change from the anchor
    is capped at 6 points; `deriveAttributes` spreads it over the nine attributes of the league's median profile for his role. Seeded
    jitter is not applied: the stats are the rating.
  - `"league-default"`: no usable estimate (no stats, another role, fewer than 8 games, a cohort too small, or a league without a level).
    The default is the median authored OVR of the rostered players of the league he last played in (the latest tournament of the pool
    window whose page matches `scripts/stats/prefix-map.json` and whose league has a level) who also have no usable estimate, when the
    league has at least 10 of them (`MIN_LEAGUE_DEFAULT_PLAYERS`). This rule is back-tested on the game's rostered players
    (`OLManager-notes/research/a6f-pool-ratings-2026-11-16.md`); the attributes keep the seeded jitter of his record and land on that OVR.
  - `"game-tier-default"`: his league has fewer than 10 such players, so the median of the same population in the game tier of that
    league (top flight or the rest) stands in. Thin: the tier-1 population is 12 players.
  - `"judgment-default"`: **a judgment, not a measurement.** No league the game models (LCP Wildcard League, Battle of S.E.A, Thailand
    Series, ...: minor leagues with no rostered counterpart). The default is the median of the game's tier-2 population of rostered
    players with no usable estimate (329 players, `JUDGMENT_DEFAULT_TIER`), the nearest measured population. Nothing validates this
    number for these leagues. A person of Leaguepedia tier 1 or 2 with no tournament in a modelled league is here. A tier-3 person with
    no mapped league is not: nothing measured tier 3, and 65 would rank him above the rostered tier-2 bench (64.0), so he keeps the
    `"tier-default"` below (the tier-3 baseline, about 57), as before the ladder existed (reason `no-mapped-league`).
  - `"tier-default"`: staff (no per-game stats), and everybody when the run has no ladder (no `--pool-stats`): for a player, the median of
    the real players of his tier in his position when the tier has at least 10 of them in the game (the same rule as the game's
    placeholder ratings), otherwise the game's median per position shifted by the tier (1 top flight, 0; 2 official circuit, -6; 3
    recurring seasonal league, -12; any other tier counts as 3); for staff, the game's median per role shifted by the tier; with the usual
    seeded jitter. Without a ladder a player whose estimate is for another role, has fewer than 8 games, or has no estimate also lands
    here, and a stats rating is anchored to this tier default instead of a league level.

  Stats come from `--pool-stats <rows.json>` (the per-game rows of `scripts/stats/pro-stats.mjs`, read from disk, no network). Competitions
  with fewer than 15 players of the role with 10 or more games give no estimate unless the ladder pools them with a similar league.
  The report counts every kind by tier and role. `pool.games` (scoreboard rows in the window, `null` if that query was unavailable),
  `entries`, `tier`, `best_level`, `leagues` and `levels` are context. `wage`, `market_value` and `contract_end` are the roster
  refresh's empty values. `dob_approx` is set when the page has no birth date. A staff add's nationality is an ISO-2 code like a
  player's (empty when the country does not resolve); the roster refresh's staff on a team keep the country name.
  The country text is `Players.Country`, or the primary nationality when `Country` does not resolve to an ISO-2 code; the spellings
  `lib/text.mjs` aliases (Moldova, DR Congo, Republic of Ireland among them) are the ones Leaguepedia uses and the country table lacks.
  A person whose Players page names no country keeps an empty nationality and the report marks the op "nationality unresolved";
  a flagless free agent is better than a guessed one.
- The tournament list of each person is summarised (count, leagues, levels) to keep the overlay small; a list longer than the wiki's
  `GROUP_CONCAT` limit sets `pool.tournaments_truncated`.

**Gates** (a failed gate exits non-zero and writes nothing unless `--allow-gate-failures`): `pool-size` (at most 5,000 pool players,
800 pool staff, and the game's own limit of 5,000 ops per list), `pool-complete` (every person has a name and a game role),
`pool-ids` (derived from the page, unique, none of the game's), `pool-no-duplicates` (no pool person matches a game record or another
pool person) and `pool-overlay-size` (the app rejects an overlay over 4 MiB: `MAX_OVERLAY_BYTES`). The roster refresh's
`max-adds-per-team` gate ignores teamless adds, and its `no-player-staff-twins` gate covers the pool too: the pool leaves out a person
the roster overlay of the run adds or moves in either role (a coach on a staff table is not also a free agent player), a person the
game's matcher finds in the bundled world in the other role (a coach of the bundled world is not also a free agent player, and the
reverse), and a player whose own Players page makes him staff when the run adds an undated staff member with his real name and
country (one coach under two pages); it refuses both pages when a page read as a player and one read as staff are the same person
(same IGN, name, country and birth date).

**Report.** A new "Active-pros pool" section: the funnel (who was left out and why), counts by position, region, level, tier and staff
kind, the effect of the qualifier cap (tournaments and roster entries kept and left out), a sample per region, the probe (is
`--pool-probe` in, and if not, which of his tournaments counts and why not) and the refused and ambiguous people with reasons.
