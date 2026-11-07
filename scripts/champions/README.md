# Pro-play lane matchups

`pro-matchups.mjs` builds a same-role lane matchup report from Leaguepedia (Cargo table `ScoreboardPlayers`,
CC BY-SA 3.0) through the world tooling client (generic User-Agent, 4 s throttle, cache). Pure aggregation lives in
`lib/lane-matchups.mjs` (tested in `src/lib/champions/laneMatchups.test.ts`).

```bash
node scripts/champions/pro-matchups.mjs --since 2025-01-01 --until 2027-01-01
node scripts/champions/pro-matchups.mjs --offline   # cache only
```

- Counter candidate: at least 12 games and a win rate of at least 55% for the source champion. 12 is the smallest
  sample where a 58% rate is still distinguishable from noise for a screening pass; treat 12-25 games as thin.
- Value bands: 55% = 1, 60% = 2, 65% = 3, 72% = 4, 80% = 5 (same 1..5 scale as the curation).
- The cache and report stay under `src-tauri/target/olm-scratch` (gitignored). Do not commit them.
- Leaguepedia may answer `ratelimited` to anonymous Cargo queries; the run then fails. Do not switch to other sites.
- Apply results through `assets/simulation/champion-counter-curation.json`, then run
  `node scripts/generate-champion-relationships.mjs` and `npm run verify:champion-relationships`.
