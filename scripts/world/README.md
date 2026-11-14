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
(default `Send0o`; `""` for none) `--pool-stats <rows.json>` (rate from stats, see Ratings). Code: `lib/pool-fetch.mjs` (queries), `lib/pool.mjs` (selection, ids, ops), `lib/pool-rating.mjs` (ratings),
`lib/pool-gates.mjs`, `lib/pool-report.mjs`. Tests: `src/lib/world/pool.test.ts`, `pool-rating.test.ts`, `pool-refresh.test.ts` with the recorded rows in
`scripts/world/fixtures/pool/`.

**Who is in.** The `recommended` tournament filter above; people not retired (`Players.IsRetired` 0 or empty) **with a Leaguepedia
Players page** (it is the only source of country, birth date and role); qualifier-flagged tournaments only when they have at most
`--pool-cap` roster entries (promotion stages and closed qualifiers stay, open qualifiers go). The cap leaves a qualifier out
whole; it never keeps "the first 60 names" of one. **Who is out.** Anybody the game has (`lib/match.mjs` plus the reviewed
`id-map.json`), anybody whose current team is in `team-map.json` (the roster overlay handles them), anybody the same run's roster
overlay adds or moves, players with no usable position, staff whose label is not coaching/analysis/scouting, and anybody the
matcher cannot settle (`ambiguous-with-game`, `duplicate-in-pool`, `id-collision`). Those are listed in the report with the reason.

**Op shape** (the game's `Player`/`Staff` record, `team_id: null`, plus a `pool` object the game ignores; `Bot` becomes `ADC`):

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
- **Ratings** (`lib/pool-rating.mjs`). `pool.rating` says where the attributes came from:
  - `"stats"` (plus `pool.rating_games`): the player has a skill estimate for his own role with at least 8 usable games (the skill model's
    write floor). The method is the one of `docs/STAT_RATINGS.md`, reusing `scripts/stats/lib`: `estimateSkill` gives a role-relative z
    shrunk by reliability (`rho`); the anchor is the tier default OVR of his role (both the "authored" value and the league median);
    `blendRating` with a league sd of 4 gives the final OVR; the change from the anchor is capped at 6 points; `deriveAttributes` spreads
    it over the nine attributes. Seeded jitter is not applied: the stats are the rating.
  - `"tier-default"`: everybody else, and all staff (no per-game stats): for a player, the median of the real players of his tier in his
    position when the tier has at least 10 of them in the game (the same rule as the game's placeholder ratings), otherwise the game's
    median per position shifted by the tier (1 top flight, 0; 2 official circuit, -6; 3 recurring seasonal league, -12; any other tier
    counts as 3); for staff, the game's median per role shifted by the tier; with the usual seeded jitter. A player whose estimate is for another role, has fewer than 8 games, or has no estimate (cohort too small) also
    lands here.
  Stats come from `--pool-stats <rows.json>` (the per-game rows of `scripts/stats/pro-stats.mjs`, read from disk, no network). Without
  it every add is a tier default. Competitions with fewer than 15 players of the role with 10 or more games give no estimate. The report
  counts both kinds by tier and role. `pool.games` (scoreboard rows in the window, `null` if that query was unavailable), `entries`, `tier`,
  `best_level`, `leagues` and `levels` are context. `wage`, `market_value` and `contract_end` are the roster refresh's empty
  values. `dob_approx` is set when the page has no birth date. A staff add's nationality is an ISO-2 code like a player's (empty when the country does not resolve); the roster refresh's staff on a team keep the country name.
- The tournament list of each person is summarised (count, leagues, levels) to keep the overlay small; a list longer than the wiki's
  `GROUP_CONCAT` limit sets `pool.tournaments_truncated`.

**Gates** (a failed gate exits non-zero and writes nothing unless `--allow-gate-failures`): `pool-size` (at most 5,000 pool players,
800 pool staff, and the game's own limit of 5,000 ops per list), `pool-complete` (every person has a name and a game role),
`pool-ids` (derived from the page, unique, none of the game's), `pool-no-duplicates` (no pool person matches a game record or another
pool person) and `pool-overlay-size` (the app rejects an overlay over 4 MiB: `MAX_OVERLAY_BYTES`). The roster refresh's
`max-adds-per-team` gate ignores teamless adds.

**Report.** A new "Active-pros pool" section: the funnel (who was left out and why), counts by position, region, level, tier and staff
kind, the effect of the qualifier cap (tournaments and roster entries kept and left out), a sample per region, the probe (is
`--pool-probe` in, and if not, which of his tournaments counts and why not) and the refused and ambiguous people with reasons.
