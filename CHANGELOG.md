# Changelog

All notable changes to OLManager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses GPL-3.0 licensing inherited from the OpenFootManager lineage unless otherwise documented.

## [0.4.0] - 2026-11-08

### Added

- One-click self-update from the fork's GitHub releases (download, install, relaunch), verified with a fork-owned signing key.
- Local fork release script (`npm run release:fork`) and `docs/RELEASING-FORK.md`.

### Fixed

- The update download progress counted percent as bytes.

## [0.3.1] - 2026-06-26

### Added

- Added GitHub tarball data import, replacing the deprecated OLMDBManager external platform. The game now downloads game data directly from `OpenLeagueManager/olmanager-data` via `codeload.github.com` (no auth, no rate limits). Thanks @aalonsolopez.
- Added bundled game data as an offline fallback. A fresh install works without internet on first run, and the online import provides updates when available. Data is resolved through a 7-tier path chain (dev, bundled resource, imported). Thanks @aalonsolopez.
- Added global image error fallback: any broken player or staff photo is replaced with the default placeholder instead of showing the browser's broken-image icon. Thanks @aalonsolopez.

### Changed

- Moved the `data/` directory to a git submodule pointing to `github.com/OpenLeagueManager/olmanager-data`, decoupling game data versioning from the application codebase. Thanks @aalonsolopez.
- Switched the auto-import pipeline from OLMDBManager ZIP downloads to GitHub tarball extraction using `tar` + `flate2` crates, with 6 passing Rust unit tests. Thanks @aalonsolopez.
- Simplified bundled-resource path resolution: removed the Tauri `_up_` prefix hack in favor of direct `resource_dir/data` paths, fixing Android compatibility without affecting desktop builds. Thanks @aalonsolopez.
- Updated all CI workflows (build, PR, release) to clone submodules automatically via `submodules: true` in 10 checkout steps across 3 pipelines. Thanks @aalonsolopez.
- Separated auto-import and manual-ZIP cache paths to prevent format corruption: auto-import writes to `olmanager_export.tar.gz`, manual ZIP import writes to `olmanager_export.zip`. Thanks @aalonsolopez.

### Fixed

- Fixed player photos showing as broken images in production builds: the asset resolver now checks bundled `resource_dir` paths, making the 2193 committed player photos available without requiring an online import. Thanks @aalonsolopez. (#352)
- Fixed Android builds failing to find game data on fresh installs by using direct `resource_dir/data` paths instead of the Tauri `_up_` prefix, which did not resolve correctly on Android. Thanks @aalonsolopez.
- Fixed economy i18n texts that inherited weekly terminology from the football-era prototype: contract wages now display as annual (`€/yr`, `€/año`, `€/ano`, `€/an`, `€/Jahr`, `€/anno`, `€/yl`), sponsor deals use one-time payments, and the runway indicator correctly shows months in all 8 supported languages. Thanks @aalonsolopez.
- Fixed football-era "training ground" / "campo de entrenamiento" references in sponsor messages, replaced with esports-appropriate "club banners" / "carteles del club" across all languages. Thanks @aalonsolopez.
- Fixed German `weeklyTotal` label incorrectly showing "Wöchentliche Gesamt" instead of "Jährliche Gesamt". Thanks @aalonsolopez.
- Fixed academy acquired inbox message always displaying in Spanish regardless of the active language; the message now uses proper i18n keys with localized text across all 8 supported languages. Thanks @aalonsolopez.
- Fixed missing filter options for player search in multiple languages, restoring the filter UI labels across all supported locales. Thanks @aalonsolopez.
- Fixed generated player names falling back to emergency placeholders in roster generation by using plausible names when the catalog has no direct match. Thanks @aalonsolopez.
- Fixed multi-league system known issues (#306): removed dead standalone playoff generators superseded by the incremental scheduler, hardened competition-ID extraction to handle dashed IDs (e.g. `emea-masters-g2`) via manifest-aware longest-prefix matching, added safe clearing and re-derivation of legacy or unknown competition references during save load and refresh so stale saves do not silently break active-league resolution, and made background-season history recording idempotent to prevent duplicate entries when a competition manifest is missing. Thanks @aalonsolopez.
- Fixed empty or failed competition-manifest scans now preserving saved competition configs and references instead of destructively clearing them, preventing data loss on transient resource or packaging failures. Thanks @aalonsolopez.
- Fixed bot lane path routing in the live simulator so minions and champions no longer cross the closed wall near the dragon pit; the path now correctly routes east of the wall polygon instead of clipping through it diagonally. Thanks @aalonsolopez.
- Fixed stale integration test expectations across the Rust test suite (contract end dates, facility upgrade costs, sponsorship terms, league/schedule fixtures, and module-path references) so the full `cargo test -p olm_core` suite is green for the release. Thanks @aalonsolopez.
- Fixed stale frontend test fixtures for delegated-renewal wage suffixes to expect annual terminology (`/yr`, `/ano`) instead of the removed weekly suffixes. Thanks @aalonsolopez.
- Fixed `Facilities` struct serialization to omit unused optional module levels from save files, producing cleaner output while remaining fully backward-compatible with legacy saves via struct-level serde defaults. Thanks @aalonsolopez.


## [0.3.0] - 2026-06-21

### Added

- Added UI v2 as the only supported interface, replacing the legacy `src/components`, `src/pages` and `App.tsx` entry points with the new `src/ui-v2` shell, dashboard, pages and shadcn primitives. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.
- Added native v2 dashboard tabs for Home, Squad, Players, Tactics, Training, SoloQ, Scrims, Scouting, Transfers, Market, Staff, Finances, Facilities, Youth, Inbox, Competitions, Teams, Meta and Manager workflows. Thanks @NicoRuedaA and @joselaguilarhz.
- Added keyboard/controller-style navigation across the main menu, league picker, team selection, dashboard sidebar, save list, create-manager form, nationality dropdown, community panel, patch notes and settings tabs. Thanks @NicoRuedaA.
- Added multi-league and multi-competition foundations: competition manifests, active competition routing, background league simulation, academy leagues, region/tier filtering, split tracking and save/load support for all leagues. Thanks @NicoRuedaA.
- Added competition browser views with standings, teams, players and all-competition calendar support. Thanks @NicoRuedaA and @joselaguilarhz.
- Added OLMDBManager-powered data import flows, including native desktop auto-import, manual local `.zip` import, cached re-import, progress reporting and safe staging/rollback. Thanks @joselaguilarhz and @NicoRuedaA.
- Added clickable staff profiles: staff cards now open a dedicated profile view with attributes, role-based gameplay impact, photo, nationality, contract details and hire/release actions. Thanks @joselaguilarhz.
- Added web/server foundations: adapter-based API layer, Supabase auth/profile/save persistence, server-side world assembly, WebSocket live match simulation and command parity groundwork. Thanks @NicoRuedaA and @joselaguilarhz.
- Added Discord Rich Presence integration with OLManager assets and activity states. Thanks @Juan / @TtvNekix.
- Added in-app bug report ZIP export to Desktop. Thanks @NicoRuedaA.
- Added a richer message/inbox system with sender metadata, trigger-based templates, high-density media messages and localized variations. Thanks @NicoRuedaA.
- Added social content foundations: JSON-backed templates, matchup conditions, avatar resolution and league-aware placeholders. Thanks @chasemrs.
- Added AI team-agent systems for roster stability, renewals, sales, purchases, strategic recruitment, free-agent signings and player-agent satisfaction decisions. Thanks @aalonsolopez.
- Added an economy ledger, dynamic simulation hooks, monthly financial processing and finance/facilities v2 UI improvements. Thanks @aalonsolopez and @NicoRuedaA.
- Added deterministic champion systems: initial champion discovery/pools, local champion splash assets, dynamic splash manifests and time-varying meta support. Thanks @NicoRuedaA and @joselaguilarhz.
- Added real SoloQ rank emblem assets and default staff imagery. Thanks @NicoRuedaA.
- Added new release-candidate build workflow for artifact generation. Thanks @aalonsolopez.

### Changed

- UI v2 is now the production UI: the old v1 toggle was removed, legacy code survives only under `src/ui-v2/_legacy` for wrappers that still need it, and `src/main.tsx` renders `AppV2` directly. Thanks @NicoRuedaA and @joselaguilarhz.
- Reworked the main menu into a game-style OLManager experience with champion splash slideshow, community/patch-notes panels, settings tabs, persistent navigation and version display. Thanks @joselaguilarhz.
- Reorganized shared frontend helpers into `src/lib`, including domain-specific modules for common helpers, dashboard, finance, formatting, home, inbox, players, schedule, scouting, scrims, season, social, squad, staff, teams, training and transfers. Thanks @NicoRuedaA and @joselaguilarhz.
- Consolidated core game logic into `olm_core`, unified command dispatch and moved academy, scrim, team-talk, time-blocker and OVR logic behind shared core seams. Thanks @NicoRuedaA.
- Reworked save persistence toward a single-file gzipped JSON format with diagnostics, format-version pruning and safer serialization checks. Thanks @NicoRuedaA.
- Reworked transfer-market behavior for AI teams, contract expiry, signing policy, player swaps, free agents, academy releases and own-club transfer/loan actions. Thanks @aalonsolopez, @NicoRuedaA, @TtvNekix and @mezxR.
- Staff are now shown by their esports nickname (e.g. "Zetz", "ZalFIRE"), falling back to the real name when no nickname is available. Thanks @joselaguilarhz.
- World (MUNDO) sidebar counters now reflect the real competitive world, excluding seeded youth-academy teams and their generated players so the totals match the imported catalog. Thanks @NicoRuedaA.
- Team roster now shows player OVR for every team, not only the user's own team. Thanks @joselaguilarhz.
- Added migration v056 introducing a `nickname` column on the staff table; existing saves are backfilled from the imported catalog on load. Thanks @joselaguilarhz.
- Replaced the financial system's weekly processing model with monthly processing and ledger-backed stabilization. Thanks @NicoRuedaA and @aalonsolopez.
- Updated data/catalog architecture around competition registries, team/player/staff image fields, competition-scoped repositories and OLMDBManager exports. Thanks @NicoRuedaA and @joselaguilarhz.
- Removed the football-era injury availability system and other football-specific dead code. Thanks @aalonsolopez, @NicoRuedaA and @joselaguilarhz.
- Improved the visual design system with zinc/orange v2 tokens, new background atmosphere utilities, page animations, Oswald/Barlow-style heading treatment, progress bars, scrollbars and better player/profile visuals. Thanks @NicoRuedaA and @joselaguilarhz.
- Migrated native v2 hardcoded strings to i18next and refreshed locale files across supported languages. Thanks @aalonsolopez, @NicoRuedaA, @chasemrs and @mezxR.
- Updated active world data, competition manifests, rosters, staff, champion assets and splash lists from current OLMDBManager/catalog sources. Thanks @NicoRuedaA and @joselaguilarhz.

### Fixed

- Fixed production data loading across Tauri installation layouts by resolving resources from executable-relative/resource paths instead of stale development locations. Thanks @NicoRuedaA and @joselaguilarhz.
- Fixed save compatibility and rehydration issues, including missing competition IDs, stale team assignments, missing teams/players, malformed player exports, null data fields and old incompatible saves. Thanks @NicoRuedaA and @joselaguilarhz.
- Fixed season and split progression issues: active league resolution, split summaries, playoff scheduling, first-day scrim setup, skip-to-match-day blockers and season preview filtering now respect the user's competition. Thanks @NicoRuedaA and @chasemrs.
- Fixed board objective scope and map-objective caps so objectives are based on the active league and winnable map totals. Thanks @aalonsolopez.
- Fixed match result mapping for press conferences and canonical score handling after live simulation/runtime winner resolution. Thanks @NicoRuedaA and @aalonsolopez.
- Imported staff now appear correctly inside active games: fixed `wage: null` (and other null fields) dropping entire staff files during parsing, and the active game's staff are now rehydrated from the imported catalog. Thanks @joselaguilarhz.
- The dashboard now refreshes the active game after an import, so newly imported players/teams/staff appear without restarting the app. Thanks @joselaguilarhz and @NicoRuedaA.
- Fixed background competition schedule generation to use `user_competition_id` and executable-relative paths. Thanks @NicoRuedaA.
- Replaced the legacy draft result screen with `DraftResultScreenV2` in match simulation. Thanks @NicoRuedaA.
- Fixed draft and champion UI issues: broken LEC logo fallback, champion splash naming, assistant-coach photos, draft-result crashes, ban icons, champion tile grids and champion-page navigation. Thanks @NicoRuedaA and @joselaguilarhz.
- Fixed condition and stamina behavior so condition affects the match engine and recovery respects post-training fatigue while reducing match stamina depletion. Thanks @joselaguilarhz and @NicoRuedaA.
- Fixed player data and display issues, including date-of-birth parsing, natural positions, null defaults, OVR refresh on load, player photos, real-name/IGN swaps, nationality flags and profile attributes without scout reports. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.
- Fixed transfer-market table layout, SoloQ tier thresholds, nationality translations, SoloQ badges, action/status column alignment and navigation conflicts in v2 transfer views. Thanks @NicoRuedaA.
- Fixed UI v2 overflow, old-theme remnants and layout issues across match screens, pre-match setup, live match, Schedule, Youth, Staff, Transfers, Champion grid, Tactics and Home lineup cards. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.
- Fixed inbox/message actions, effect toasts, mood-report translations, event action button translations and removed obsolete international call-up/charity-match content. Thanks @chasemrs.
- Fixed web/server crashes and command gaps around dashboard routing, finance/competitions/training imports, academy persistence, scrim context, stats overview, transfer bids and imported player/photo data. Thanks @NicoRuedaA and @joselaguilarhz.
- Fixed build, package and release-candidate validation blockers, including Rust package checks, current core-model tests, legacy test mocks, v2 color-token expectations and Tauri/Vite localhost issues. Thanks @aalonsolopez and @chasemrs.
- Fixed Android/build configuration issues and desktop window/icon configuration problems. Thanks @chasemrs, @NicoRuedaA and @Juan / @TtvNekix.

### Chores

- Removed the failed web implementation from the desktop release path, the legacy HTTP server crate, unused world IO, stale theme/avatar/profile commands, debug tooling and obsolete `world.json` references. Thanks @NicoRuedaA and @joselaguilarhz.
- Added and maintained Playwright E2E coverage for the main game flow, dashboard loading, tab navigation, advance-time, squad, training, schedule, settings and save/load flows. Thanks @NicoRuedaA.
- Updated documentation for dashboard architecture, inbox/message architecture, data model, web migration planning, UI v2 handoff, release process and data/attribute references. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.
- Cleaned repository state after merge/rebase conflicts, removed dead files and synchronized generated asset manifests, Cargo lockfiles and locale data. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.

### Contributors

- Thanks to @NicoRuedaA / Nico Rueda for the UI v2 migration, multi-league architecture, data/model cleanup, desktop release fixes, E2E coverage and many gameplay/UI fixes.
- Thanks to @joselaguilarhz for OLMDBManager import work, menu/web foundations, data import hardening, champion/market-value improvements and many data/UI fixes.
- Thanks to @aalonsolopez for AI team/player-agent systems, economy stabilization, release-candidate validation, localization work and core bug fixes.
- Thanks to @chasemrs for social templates, message/i18n fixes, Android/dev-server fixes and event-content cleanup.
- Thanks to @Juan / @TtvNekix for Discord Rich Presence work and player release/academy re-signing fixes.
- Thanks to @mezxR for transfer-market, negotiation and localization contributions.
- Thanks to @drumst0ck (Jose Sánchez) for expanded esports media commentary variants.

## [0.2.1] - 2026-05-13

### Added

- Added profile image URL support to player data and related frontend components.
- Added SoloQ rank and staff impact localisation strings across supported languages.

### Changed

- Improved transfer handling in squad flows, including roster destination behaviour and related transfer tests.
- Improved player role resolution so active lineup role data and natural position are handled consistently across live match, dashboard, squad and training views.

## [0.2.0] - 2026-05-07

### Added

- Added Turkish localisation and improved Turkish translations across the game. Thanks @aalonsolopez and Shammminggg on Discord. (#76, #202, #203)
- Added in-app auto-updater flow with Tauri updater integration, frontend updater UI, translations, signed bundles and `latest.json` support. Thanks @108M and @aalonsolopez. (#91, #153)
- Added the Champions/Meta system: champion catalog, champion pages, persistence, progression, stats, role distribution and stat cards. Thanks @NicoRuedaA. (#121, #192)
- Added Scrims and Social V1, including scrim planning, social posts, registry/templates, editor UI and dashboard/training integration. Thanks @chasemrs. (#160, #206)
- Added assistant-coach delegated training. Thanks @almuoluupv / @mezxR. (#136)
- Added x8 and x12 match simulation speed options. Thanks @almuoluupv / @mezxR. (#139)
- Added UI/UX quality-of-life improvements across player profiles, scouting, transfers, finances, academy, dashboard search, logos, photos, role icons and sortable tables. Thanks @NicoRuedaA. (#121, #124)
- Added Rust → TypeScript type generation foundations with `ts-rs`, plus validation groundwork with Rust `validator` and TypeScript Zod schemas. Thanks @NicoRuedaA. (#121)
- Added security hardening around CSP, Tauri capabilities, path traversal protection and safer game DB access patterns. Thanks @NicoRuedaA. (#121)

### Changed

- Completed a major football-to-League-of-Legends migration across domain, database, engine and frontend:
  - `Position` replaced with `LolRole`
  - football match events removed from the engine
  - goals renamed/replaced with LoL score/kills terminology
  - stadium fields renamed to arena fields
  - set-piece concepts replaced with `TeamRoles`
  - football-specific fields such as `football_nation` removed from active models and data  
  Thanks @NicoRuedaA and @aalonsolopez. (#65, #68, #69, #70, #72, #75, #80, #83, #121, #122, #123, #124, #151, #156, #159, #201, #207)
- Reworked the match engine from legacy football simulation toward LoL-native simulation concepts. Thanks @NicoRuedaA and @aalonsolopez. (#123, #124, #207)
- Replaced “Starting XI” terminology and UI with LoL lineup language and five-role lineup expectations. Thanks @aalonsolopez. (#151, #201)
- Unified OVR calculation across Squad, Tactics and Engine views, and renamed player attributes to visible LoL stat names. Thanks @NicoRuedaA. (#194)
- Replaced OpenFoot branding/menu assets and removed remaining football terminology from locale files. Thanks @aalonsolopez. (#158, #159)
- Updated README, roadmap, architecture docs and ADRs to reflect the LoL migration and technical direction. Thanks @NicoRuedaA and @aalonsolopez. (#121)

### Fixed

- Fixed first-year friendly scheduling getting locked. Thanks @aalonsolopez. (#187)
- Fixed player age calculation so ages are based on the in-game date. Thanks @aalonsolopez. (#189)
- Fixed database team upsert crashes and positional row mapping issues. Thanks @NicoRuedaA. (#191)
- Fixed missing scrim columns and related migration/index issues. Thanks @NicoRuedaA and @chasemrs. (#160, #192, #206)
- Fixed scouting of own players so own-team scouting can return perfect-accuracy reports, plus scouting UI overlap. Thanks @108M. (#205)
- Fixed draft champion count issues and progression requiring the five LoL roles. Thanks @almuoluupv / @mezxR and @aalonsolopez. (#132, #157)
- Fixed placeholder coach naming from a football manager reference to a LoL-appropriate placeholder. Thanks @almuoluupv / @mezxR. (#134)
- Fixed updater release metadata by publishing signed latest manifests and adding updater public-key configuration. Thanks @aalonsolopez. (#153)
- Fixed old-save and migration compatibility issues around champion data, profile images, role casing, corrupted locale JSON and DB schema evolution. Thanks @NicoRuedaA. (#121, #122, #124)
- Fixed Dashboard crash caused by conditional hooks and several ChampionPage/ChampionsWorld navigation issues. Thanks @NicoRuedaA. (#121, #124)
- Fixed Rust test compilation and DB runtime test expectations after the migration work. Thanks @aalonsolopez. (#196, #198)

### Chores

- Renamed backend crate from `openfootmanager_lib` to `olmanager_lib`. Thanks @NicoRuedaA. (#65)
- Removed dead frontend/backend code and renamed legacy identity files away from football-specific naming. Thanks @NicoRuedaA. (#66, #73)
- Enabled/expanded Rust checks, clippy validation and CI security/audit gates. Thanks @NicoRuedaA. (#67, #71, #121)
- Cleaned active seed data and locales to remove football remnants. Thanks @aalonsolopez. (#156, #159)

### Contributors

- Thanks to @keremozmeen (Kerem Özmen) for the LoL-native engine attribute/rating work that was manually ported in #207 from #204.
- Thanks to Shammminggg on Discord for the Turkish translation corrections captured in #202 and shipped via #203.

## [0.1.2] - 2026-04-30

### Added

- Added ScheduleCalendarView to display selected scrims with opponent name and logo when a scrim opponent is configured.
- Added realistic board objectives based on team strength: objectives are now generated based on the roster's average skill compared to the rest of the league, not static reputation thresholds.
- Added end-of-season board objective review message with objectives completed count and satisfaction delta.
- Added visible gold advantage chart with proper LoL-style formatting (blue advantage rises, red advantage falls) and chronological timeline plotting.
- Added i18n keys for board objective review messages (`be.msg.boardObjectiveReview.subject`, `be.msg.boardObjectiveReview.body`).
- Added roster destination selection for new signings: users can now choose to assign a new signing to either the Main Team or the Academy squad.
- Added updated world data with recalibrated player statistics and market costs.

### Changed

- Restyled the post-match gold advantage chart with improved visuals: gradient line, side-colored segments (blue above center, orange below center), final advantage summary, and peak display.
- Adapted tournament and schedule standings tables to LoL format: removed "drawn" column and "points", replaced goals with "Maps" (e.g., "12-4") and "Map Diff" (e.g., "+8", "-3").
- Changed series objective calculation to use roster skill comparison: strong teams get title-contender objectives, mid-table teams get playoff objectives, weak teams get survival objectives.
- NeutralTimersState now uses typed fallbacks instead of empty objects to satisfy TypeScript requirements.
- Refactored world data loading: the system now reads world data exclusively from `lec_world.json`.
- Improved Draft AI logic: refined pick selection to prevent nonsensical choices and ensure bans do not target roles already picked.

### Fixed

- Fixed Bo3/Bo5 series completion: the series now correctly detects when a team reaches the required wins (2 for Bo3, 3 for Bo5) and ends appropriately.
- Fixed Bo3 one-map finalization bug: added a hard invariant requiring both reaching target wins AND having enough played maps to support that score.
- Fixed stale series advance button label: after a Bo3/Bo5 completes, the button now shows "Continue" instead of a stale "Game 2/3" label.
- Fixed final series scoreboard reset: the 2-1 or 3-x final score now persists and displays correctly after series completion instead of resetting to 0-0.
- Fixed press conference availability: press conference is now correctly gated to only appear for single games or completed series, not for in-progress Bo3/Bo5.
- Fixed NeutralTimersState TypeScript error: added typed fallback helpers (`createEmptyNeutralTimersState`, `createDefaultObjectivesState`) to satisfy type requirements.
- Fixed missing handleStartGame function that prevented creating a new career after finishing a previous one.
- Fixed board objective end-of-season feedback: objectives now trigger a visible inbox message with results and satisfaction changes.
- Fixed football/soccer terminology in initial season objectives email: replaced football terms (matches, goals, top half) with LoL/esports terms (split, series, maps, LEC table).
- Fixed gold advantage chart trajectory: the chart now correctly plots blue advantage going up, red advantage going down, and crossing the centerline appropriately.
- Fixed standings table format: converted from soccer-style (drawn, goals for/against, points) to LoL-style (played, won, lost, maps, map difference) in both TournamentsTab and ScheduleTab.
- Fixed position swapping during the draft phase: players can now correctly change positions and roles.

### Contributors

- Thanks to @drumst0ck (Jose Sánchez) for the NeutralTimersState TypeScript fix, amd the help in changing some content in the events of the game to use real media!
- Thanks to @nicoruedaa (Nico Rueda) for all the changes to QoL in UI related to transfers, player list and team icons.
- Thanks to @rcfarah for the help in PT_BR translations.


## [0.1.1] - 2026-04-28

### Added

- Added quality-of-life improvements to champion draft, including faster draft skipping, better role ordering, and champion sorting/filtering by meta and mastery.
- Added spectator/delegated match flow improvements so AI-controlled drafts and simulations can progress more smoothly through series games.

### Changed

- Improved match simulation and draft-result handling for series play, including safer handling of persisted draft results between games.
- Improved translations and UI labels across player, squad, champions, academy, and localized text.
- Removed duplicated draft players and the unavailable Omon free-agent entry from draft data.

### Fixed

- Fixed season-end progression issues and added coverage for end-of-season behavior.
- Fixed repeated press-conference questions by rotating recent questions and selecting a more varied question set.
- Fixed transfer messages to display match names instead of full names.
- Fixed the continue menu dropdown overlapping other UI elements.
- Disabled the native browser context menu in the Tauri app so the desktop experience behaves consistently.
- Fixed multiple transfer, potential, live-match, and match-simulation edge cases.

### Contributors

- Thanks to @drumst0ck (Jose Sánchez) for the transfer-message, continue-menu z-index, and Tauri context-menu fixes.

### Notes

- Release artifacts remain source-first; signing, notarization, and binary packaging policy are still not finalized.

## [0.1.0]

### Added

- Live Game simulation
- Customizable draft
- Player trading
- Installation management
- Functional Academy
- Training plans
- Scouting
- FULLY PLAYABLE (maybe not for long plays, but playable)
- Post-Game Press Conference
- Champion Mastery
- Live Patch/Meta changes
- Repository governance docs, issue templates, PR template, and non-production CI workflow for public OSS preparation.
- Provenance guidance separating GPL-inherited code/assets from third-party datasets and generated caches.
- Inherited documentation audit checklist for deciding which original-repository docs to keep, update, move to legacy, or remove before public OSS release.

### Notes

- Release artifacts are source-first until maintainers decide signing, notarization, and binary packaging policy.
