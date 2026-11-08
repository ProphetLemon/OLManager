# OLManager Architecture

This document is a practical map for contributors. It describes the current architecture in the repository, not an aspirational rewrite.

OLManager is a desktop game built with **Tauri v2**: a **React + TypeScript** frontend runs in the WebView, while gameplay state, persistence, and long-running simulation logic live in the **Rust backend**.

## System overview

```mermaid
C4Context
  Person(user, "Player", "Desktop game user managing an esports team")

  System_Boundary(frontend, "WebView (React 19 + TS)") {
    System(ui, "Pages & Components", "src/pages/, src/components/")
    System(store, "Zustand stores", "src/store/ (game, settings)")
    System(svc, "IPC Services", "src/services/ (typed invoke wrappers)")
  }

  System_Boundary(backend, "Tauri v2 Backend (Rust)") {
    System(cmd, "Command layer", "src-tauri/src/commands/ (thin handlers)")
    System(app, "Application services", "src-tauri/src/application/")
    System(sm, "StateManager", "olm_core::state (unified Session)")
    System(core, "olm_core", "Domain, engine, gameplay, persistence")
  }

  System_Ext(leaguepedia, "Leaguepedia API", "External data (optional)")

  Rel(ui, store, "reads/writes")
  Rel(ui, svc, "calls")
  Rel(svc, cmd, "invoke('cmd', payload)")
  Rel(cmd, app, "delegates to")
  Rel(cmd, sm, "reads/writes state")
  Rel(cmd, core, "loads/saves game")
  Rel(cmd, core, "orchestrates gameplay")
  Rel(ui, leaguepedia, "fetches champion data", "optional")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="2")
```

The frontend should present state, collect user intent, and call typed service functions. The backend owns authoritative game state, simulations, save/load, and mutations that affect the career.

## Frontend architecture

Frontend code lives under `src/` and is built by Vite.

- `main.tsx` mounts React in `StrictMode`, wraps the app with `ThemeProvider`, and initializes i18n.
- `App.tsx` defines lazy-loaded routes with `react-router-dom` for `/`, `/select-team`, `/dashboard`, `/match`, and `/settings`.
- `pages/` contains route-level screens such as the main menu, dashboard, team selection, match simulation, and settings.
- `components/` contains feature UI and reusable UI pieces. Several feature areas have local view-model/helper files and tests.
- `services/` is the frontend IPC adapter layer. Services call Tauri commands via `invoke(...)` and expose TypeScript-friendly functions such as `advanceTimeWithMode`, `skipToMatchDay`, and player/training/staff actions.
- `store/` uses Zustand for client-side UI/session state. `gameStore.ts` tracks active game data returned by Rust; `settingsStore.ts` loads and persists settings through backend commands.
- `hooks/` contains UI orchestration hooks. For example, `useAdvanceTime` coordinates modals/navigation and delegates the actual mutation to `advanceTimeService`.
- `i18n/` configures `i18next`/`react-i18next` and locale JSON files.
- `lib/` and `utils/` hold frontend-only helpers, formatting, lightweight calculations, and backend-to-UI translation utilities.

Frontend tests use **Vitest**, **jsdom**, and **React Testing Library**. The test configuration is in `vite.config.ts`; tests are colocated as `*.test.ts` and `*.test.tsx` under `src/`.

## Tauri boundary

Tauri commands are registered in `src-tauri/src/lib.rs` with `tauri::generate_handler![...]`. Command modules live in `src-tauri/src/commands/` and are grouped by feature (`game`, `time`, `transfers`, `squad`, `staff`, `settings`, `live_match`, stats, etc.).

Use this boundary deliberately:

- Frontend code should call command names through small service functions in `src/services/`, not scatter raw `invoke(...)` calls throughout components.
- Tauri commands should validate inputs, load/update `StateManager`, call application/core/db functions, and return serializable DTOs or domain structures.
- Business rules that must be consistent across UI flows belong in Rust (`olm_core`, or application services), not in React components.
- UI-only state, presentation preferences, and navigation belong in React/Zustand/hooks.

The backend keeps process-level state with Tauri-managed objects:

- `olm_core::state::StateManager` stores the active `Game`, stats state, live match session, and active save id within a single `Mutex<Session>` (unified lock — no deadlock risk).
- `SaveManagerState` wraps `db::save_manager::SaveManager` for save listing/loading/saving/deleting.

## Rust workspace and module responsibilities

The Rust backend is a workspace declared in `src-tauri/Cargo.toml` with a single crate: `olm_core`.

### `olm_core`

`src-tauri/crates/olm_core` is the single backend crate. The old 4-crate workspace (`domain`, `engine`, `ofm_core`, `db`) was consolidated into `olm_core` as modules. It contains:

- **`domain/`** — Serializable domain data types: players, teams, leagues, managers, staff, messages, news, season context, stats, negotiations, and identity structures. Depends only on general-purpose libraries (`serde`, `serde_json`, `log`).
- **`engine/`** — Match simulation logic (pure, no I/O). Exposes `simulate`, `LiveMatchState`, `MatchCommand`, `MatchSnapshot`, `MatchReport`.
- **`db/`** — SQLite persistence. Contains `GameDatabase` (per-save SQLite with migrations up to V55), `repositories/`, `GamePersistenceReader`/`GamePersistenceWriter`, `SaveManager`.
- **`game.rs`** — Central career object (`Game`), clock, club systems, contracts, finances, training, scouting, transfers, schedules.
- **`state.rs`** — Runtime session state (`StateManager` with unified `Mutex<Session>`).
- **`sim_live.rs` / `sim_live/`** — Live match engine (25+ submodules). Team strength (visible stats and the role-impact edge) acts through one persistent champion-vs-champion damage factor, `exp(K * (power(attacker) - power(defender)))` (`champion_strength_damage_multiplier`), so it survives level scaling; the outcome targets and the opt-in sweep are in `sim_live/strength_tests.rs`.
- Plus modules for: academy, champions, social, news, messages, turn logic, time blockers, player events, scrims, season awards, etc.

### Tauri app crate

`src-tauri/src` wires the desktop application together. `lib.rs` configures plugins, logging, managed state, app data directories, legacy save migration, and command registration. `application/` contains backend orchestration that is too app-specific for the core crate, such as time advancement and live-match flow coordination.

## Persistence and save/load model

OLManager uses a per-save SQLite model:

1. On startup, Tauri creates the app data directory and initializes `SaveManager` in an app-data `saves/` directory.
2. Starting a new game creates a new save database through `SaveManager::create_save` and stores its id in `StateManager`.
3. `GameDatabase::open` creates or opens a `.db` file and applies all migrations before use.
4. `GamePersistenceWriter` writes game metadata, manager, teams, players, staff, messages, news, league, objectives, scouting assignments, and stats through repositories.
5. `GamePersistenceReader` loads the same tables back into an `olm_core::game::Game` and refreshes derived season context.
6. The save index records save id, name, manager name, db filename, checksum, creation time, and last played time.
7. `save_game` persists the active game and stats. `exit_to_menu` auto-saves when there is an active save id, then clears in-memory state.

Settings are separate from career saves: `get_settings`/`save_settings` read and write `settings.json` in the app data directory.

## Dependency direction and architectural rules

The current code supports this dependency direction:

```text
React UI → frontend services → Tauri commands/application
Tauri commands/application → olm_core (gameplay, engine, persistence, domain)
server → olm_core
olm_core modules: domain ← engine ← gameplay ← persistence
```

Contributor rules of thumb:

- Do not put durable business rules only in React. If a rule changes saved game state or simulation results, implement it in Rust and expose it through a command.
- Keep `domain/` free of Tauri, SQLite, and UI-specific code.
- Keep `engine/` focused on simulation. Do not make it depend on save files or Tauri commands.
- Keep persistence behind `db/` repositories. Do not issue SQLite queries from command modules.
- Keep command modules thin enough to be understandable: parse/validate input, call core/application/db, update `StateManager`, return data.
- Keep frontend `services/` as the IPC boundary. Components and hooks should use service functions instead of raw command strings when possible.

## Testing strategy

- Frontend: `npm test` runs Vitest in jsdom. Use React Testing Library for components/pages/hooks and plain Vitest for helpers, stores, and services.
- TypeScript contract checks: `npm run build:types` runs the release TypeScript config without creating a Tauri production bundle.
- Rust formatting/linting: use `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo check`, and `cargo clippy --workspace --all-targets -- -D warnings`.
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml --workspace` covers `olm_core` (simulation, gameplay, persistence) and command-level tests.

Do not run production Tauri bundle builds for normal documentation or PR validation work.

## Adding a new feature safely

1. Decide where the rule belongs. UI-only behavior goes in React; game-state mutations and simulations go in Rust.
2. Add or extend domain types in `olm_core::domain` only when the model needs new durable fields or shared serializable structures.
3. Implement gameplay behavior in `olm_core` with module-level tests.
4. If the feature must be saved, add a migration and repository/persistence updates in `olm_core::db`.
5. Expose the behavior through a Tauri command in `src-tauri/src/commands/` and register it in `lib.rs`.
6. Add a typed frontend service wrapper in `src/services/`.
7. Update Zustand stores/hooks/pages/components only for presentation and UI flow.
8. Add or update tests at the lowest useful layer first, then add UI tests for user-visible behavior.
9. Update docs and data provenance notes when the feature touches inherited assets, generated data, or third-party sources.

When in doubt, follow the dependency direction above. The UI can ask for a change; Rust decides whether the career state is valid.
