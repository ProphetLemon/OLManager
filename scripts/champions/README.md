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

## Logging in

Leaguepedia may answer `ratelimited` to anonymous requests. `--login` (on `pro-matchups.mjs` and
`scripts/world/refresh.mjs`) logs in once with a MediaWiki bot password before the first query. It is opt-in.
It is unverified whether a logged-in normal account avoids the Cargo rate limit; the first live run is the test.

1. Log in to https://lol.fandom.com with a Fandom account.
2. Open https://lol.fandom.com/wiki/Special:BotPasswords and create a bot named `olmanager`. Leave only the basic
   grant (read is enough, no edit grants). The page then shows the exact login name (`Account@olmanager`) and a password.
3. Create the private file (works in fish and bash), then open it in an editor and write the two lines:

   ```bash
   mkdir -p ~/.config/olmanager
   test -e ~/.config/olmanager/leaguepedia-bot.env || install -m 600 /dev/null ~/.config/olmanager/leaguepedia-bot.env
   ```

   ```
   LEAGUEPEDIA_BOT_USER=<login name shown by Special:BotPasswords>
   LEAGUEPEDIA_BOT_PASSWORD=<generated password>
   ```

4. Run with the flag: `node scripts/champions/pro-matchups.mjs --login` or `npm run world:refresh -- --login`.

The file must not be readable by other users (`chmod 600`); the tool refuses it otherwise. Credentials are sent only
over https to `lol.fandom.com`, cookies stay in memory, and login requests are never cached. Offline runs ignore `--login`.
