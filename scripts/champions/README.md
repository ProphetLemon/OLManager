# Pro-play lane matchups

`pro-matchups.mjs` builds a same-role lane matchup report from Leaguepedia (Cargo table `ScoreboardPlayers`,
CC BY-SA 3.0) through the world tooling client (generic User-Agent, 4 s throttle, cache). Pure aggregation lives in
`lib/lane-matchups.mjs` (tested in `src/lib/champions/laneMatchups.test.ts`).

```bash
node scripts/champions/pro-matchups.mjs --since 2025-01-01 --until 2027-01-01
node scripts/champions/pro-matchups.mjs --offline   # cache only
```

- Counter candidate: at least 20 games and a 95% Wilson lower bound of at least 50% for the source champion's win
  rate. A raw rate such as 7/12 (58%) is within chance, so the gate uses the lower bound, not the point estimate.
  Many pairs are screened with no multiple-comparison correction: treat candidates as leads to review, not as facts.
- Value bands apply to the lower bound: 50% = 1, 52% = 2, 55% = 3, 60% = 4, 70% = 5 (same 1..5 scale as the curation).
- Champion names are mapped to game ids through `assets/simulation/champion-list.json` (id and name); names that do
  not resolve are skipped and listed in the report (`unresolvedChampions`).
- The cache and report stay under `src-tauri/target/olm-scratch` (gitignored). Do not commit them.
- Leaguepedia may answer `ratelimited` to anonymous Cargo queries; the run then fails. Do not switch to other sites.
- Apply results through `assets/simulation/champion-counter-curation.json`, then run
  `node scripts/generate-champion-relationships.mjs` and `npm run verify:champion-relationships`.
