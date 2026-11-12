<h1 align="center">Open League Manager</h1>

<p align="center">
  <a href="https://v2.tauri.app/">
    <img src="https://img.shields.io/badge/Tauri-v2-%23FFC131?logo=tauri" />
  </a>
  <a href="https://www.rust-lang.org/">
    <img src="https://img.shields.io/badge/Rust-1.80+-orange?logo=rust" />
  </a>
  <a href="https://react.dev/">
    <img src="https://img.shields.io/badge/React-19+-blue?logo=react" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-6.0+-3178C6?logo=typescript&logoColor=white" />
  </a>
  <a href="https://www.gnu.org/licenses/gpl-3.0">
    <img src="https://img.shields.io/badge/License-GPL--3.0-brightgreen" />
  </a>
  <img src="https://img.shields.io/badge/Status-Pre--alpha-yellow" />
</p>

<img src="https://github.com/OpenLeagueManager/.github/raw/main/Game-Banner.png">

---

> **Current Status:** Pre-alpha — expect incomplete gameplay systems, evolving save formats, and frequent documentation updates.  
> **Last Updated:** 22-MAY-2026

---

## 1. What is Open League Manager?

**Open League Manager (OLManager)** is a public, GPL-3.0 desktop management game built with **Tauri v2**, **Rust**, **React**, and **TypeScript**. The project continues the OpenFootManager lineage while focusing on transparent community contribution, maintainable releases, and careful data provenance.

- **Cross-platform desktop** — native performance via Tauri v2, runs on Windows, macOS, and Linux
- **Rust-powered backend** — type-safe, zero-cost abstractions for game simulation and data processing
- **React + TypeScript frontend** — modern reactive UI with full type coverage
- **Community-first** — public, transparent development with an issue-first contribution model
- **Data provenance** — careful tracking of external data and asset sources

**Architecture:** Hybrid Tauri v2 (Rust backend / React-TypeScript frontend), Hexagonal architecture in Rust with domain-driven design.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        APPLICATION ARCHITECTURE                            │
│                                                                            │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │  FRONTEND (React + TypeScript)                                  │      │
│   │                                                                 │      │
│   │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │      │
│   │  │  Pages    │  │Components │  │  Stores   │  │  Lib/Utils   │  │      │
│   │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘  │      │
│   │        └──────────────┴──────────────┴───────────────┘          │      │
│   │                          │ Tauri IPC                            │      │
│   └──────────────────────────┼──────────────────────────────────────┘      │
│                              │                                             │
│   ┌──────────────────────────┼──────────────────────────────────────┐      │
│   │  BACKEND (Rust)          │                                      │      │
│   │                          ▼                                      │      │
│   │  ┌──────────────────────────────────────────────────────────┐   │      │
│   │  │  Tauri Commands ───► Domain Logic ───► Persistence       │   │      │
│   │  │  (IPC handlers)      (crates/)         (SQLite/FS)       │   │      │
│   │  └──────────────────────────────────────────────────────────┘   │      │
│   └─────────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────────┘
```

The full system overview is documented at [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — including the React/Tauri boundary, Rust crate map, persistence layer, testing strategy, and feature-extension rules.

---

## 3. Technical Requirements

| Technology    | Version      | Notes                                        |
|---------------|-------------|----------------------------------------------|
| Rust          | **1.80+**   | Edition 2021, required for Tauri v2 builds   |
| Node.js       | **20+**     | Required for frontend tooling                |
| npm           | **10+**     | Package manager for frontend dependencies    |
| Tauri CLI     | **2.x**     | `cargo install tauri-cli --version "^2"`     |

### Core Dependencies

```bash
# Rust crates (Cargo.toml)
tauri = "2"
serde = "1"       # Serialization
rusqlite = "0.32.1" # SQLite persistence

# Frontend (package.json)
react = "^19"
typescript = "^6.0"
@tauri-apps/api = "^2.11"
```

---

## 4. Quick Installation

```bash
# 1. Install frontend dependencies
npm ci

# 2. Run stable non-production checks
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
```

Broader non-production checks are also available, currently tracked as pre-existing runtime/test debt and exposed through manual experimental CI jobs:

```bash
npm test
npm run build:types
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

> Do not run production Tauri bundle builds as part of normal PR validation. Packaging belongs to the release process.

### macOS: "app is damaged" warning

macOS builds are ad-hoc signed but not notarized (no Apple Developer account), so Gatekeeper may report the downloaded app as "damaged". To open it:

- System Settings → Privacy & Security → scroll to the blocked app message → **Open Anyway**, or
- Remove the quarantine flag from a terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Open League Manager.app"
```

### Linux: blank or flickering window

On Linux the game asks, the first time it starts, how it should draw its window: **Fast** (recommended, uses the graphics card) or **Compatibility** (slower, most of all in fullscreen, but it avoids drawing problems seen with some graphics drivers on Wayland). Tick "remember my choice" to stop being asked; otherwise it asks again at the next start. You can change the choice at any time in Settings, under "Graphics mode" (it applies the next time you open the game).

If the window flickers, draws wrongly or stays blank, choose Compatibility. As a last resort, and for scripts, you can start the game with the variable set; when it is set the game never asks and never overrides it:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 <command that starts the game>   # compatibility rendering
WEBKIT_DISABLE_DMABUF_RENDERER=0 <command that starts the game>   # accelerated rendering
```

---

## 5. Project Structure

```
OLManager/
├── src/                                        # Frontend (React + TypeScript)
│   ├── App.tsx                                 # Root application component
│   ├── main.tsx                                # Entry point
│   ├── components/                             # UI components
│   ├── pages/                                  # Route pages
│   ├── store/                                  # State management
│   └── lib/                                    # Utilities and helpers
│
├── src-tauri/                                  # Backend (Rust)
│   ├── Cargo.toml                              # Rust dependencies
│   ├── src/                                    # Tauri commands and setup
│   └── crates/                                 # Domain crates
│       ├── domain/                             # Domain models and enums
│       ├── ofm_core/                           # Core game logic
│       └── ...                                 # Additional crates
│
├── docs/                                       # Documentation
│   ├── ARCHITECTURE.md                         # System architecture
│   ├── GOVERNANCE.md                           # Branch model and review gates
│   ├── RELEASE_PROCESS.md                      # Release workflow
│   ├── DATA_PROVENANCE.md                      # External data sources
│   └── INHERITED_DOCS_AUDIT.md                 # Documentation audit
│
├── README.md                                   # This file
├── CONTRIBUTING.md                             # Contribution guidelines
├── SECURITY.md                                 # Vulnerability reporting
└── LICENSE                                     # GPL-3.0 license
```

---

## 6. Code Conventions

### Rust Conventions

- **Crates:** Lowercase with underscores (e.g., `ofm_core`, `player_rating`)
- **Types:** PascalCase (e.g., `Player`, `TeamComposition`)
- **Functions/Methods:** snake_case (e.g., `calculate_rating()`)
- **Enums:** PascalCase variants (e.g., `LolRole::Support`)
- **Error handling:** Custom error types with `thiserror`

### TypeScript / React Conventions

- **Components:** PascalCase (e.g., `PlayerCard`, `SquadView`)
- **Hooks:** camelCase with `use` prefix (e.g., `usePlayerData`)
- **Files:** PascalCase for components, camelCase for utilities
- **Types:** PascalCase interfaces and type aliases

### Commits

Format: `<type>(<scope>): <description>`

```bash
feat(player): add LolRole assignment
fix(scouting): correct rating calculation
refactor(team): replace formation with TeamComposition
docs(readme): update architecture diagram
```

---

## 7. License and Lineage

This repository is licensed under the **GNU General Public License v3.0**. See [`LICENSE`](LICENSE).

Code and assets inherited from OpenFootManager are treated as GPL-3.0-compatible unless a later audit documents otherwise. Third-party datasets, generated caches, and source-derived content such as Leaguepedia data are **not** automatically GPL by inheritance; they require separate provenance, attribution, and redistribution review. See [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md).

### Riot Games

Open League Manager is not endorsed or sponsored by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc. This is a free, non-commercial fan project.

### Third-party data credits

Player ratings in new games are derived from pro match statistics from [Leaguepedia](https://lol.fandom.com), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Method and refresh steps: [`docs/STAT_RATINGS.md`](docs/STAT_RATINGS.md). Whether ShareAlike applies to the derived rating asset is an open question for the owner.

The item catalogue and champion kits under `assets/simulation/` (`items.v1.json`, `champion-kits.v1.json`) and the item, summoner spell and ability icons come from Riot Games' [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon). The champion builds and presence in `assets/simulation/champion-builds.v1.json` are aggregated from professional match data from [Leaguepedia](https://lol.fandom.com), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); that file is offered under the same licence. How to refresh them: [`scripts/game-data/README.md`](scripts/game-data/README.md).

---

## 8. Contributing

Contributions are **issue-first**:

1. **Open a template-based issue** or join **Discussions** for questions.
2. **Wait for maintainer approval** via `status:approved`.
3. **Branch from `development`** using `type/lowercase-slug`, for example `fix/ci-labels`.
4. **Open the PR against `development`** unless it is a maintainer release or hotfix promotion.

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), then review:

- [`docs/STATUS.md`](docs/STATUS.md) — project health overview: what's broken, technical debt (53 football remnants), risks, and roadmap.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system overview, React/Tauri boundary, Rust crates, persistence, testing, and feature-extension rules.
- [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) — branch model, labels, review gates, and repository settings.
- [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md) — release PRs, version sync, tags, artifacts, and unsigned status rules.
- [`docs/INHERITED_DOCS_AUDIT.md`](docs/INHERITED_DOCS_AUDIT.md) — required audit follow-up for inherited documentation before public OSS release.
- [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md) — external data and asset provenance requirements.
- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting guidance.

---

## 9. Resources

---
- **Repository:** [github.com/OpenLeagueManager/OLManager](https://github.com/OpenLeagueManager/OLManager)
- **Documentation index:** [`docs/README.md`](docs/README.md)
- **Tauri v2 Docs:** [https://v2.tauri.app/](https://v2.tauri.app/)
- **Rust Docs:** [https://doc.rust-lang.org/](https://doc.rust-lang.org/)
- **React Docs:** [https://react.dev/](https://react.dev/)

---

<i>Built with Rust + Tauri + React + TypeScript + Community + Passion</i>
