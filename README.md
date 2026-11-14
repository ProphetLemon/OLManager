<h1 align="center">Open League Manager · Limón Edition 🍋</h1>

<p align="center">
  <a href="https://v2.tauri.app/">
    <img src="https://img.shields.io/badge/Tauri-v2-%23FFC131?logo=tauri" />
  </a>
  <a href="https://www.rust-lang.org/">
    <img src="https://img.shields.io/badge/Rust-1.85+-orange?logo=rust" />
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

> **Current Status:** Pre-alpha. Expect incomplete gameplay systems and evolving save formats.
> **Last Updated:** 2026-11-12

---

## What is this?

**Open League Manager** is a League of Legends esports team-management game for the desktop: you run a pro team, scout and sign players, set the tactics, play scrims and watch your matches.

This repository is the **Limón Edition**, a fork of the original [OpenLeagueManager/OLManager](https://github.com/OpenLeagueManager/OLManager) project. It is built with Tauri v2, Rust, React and TypeScript, and it is licensed under GPL-3.0.

## Download and play

Get the latest version from the **[releases page](https://github.com/ProphetLemon/OLManager/releases/latest)**. Under "Assets", pick the file for your system.

| System | File | How to install |
|--------|------|----------------|
| Windows (64-bit) | `Open.League.Manager_<version>_x64-setup.exe` | Run it. It installs for your user only. |
| Linux (64-bit) | `Open.League.Manager_<version>_amd64.AppImage` | Make it executable (`chmod +x`), then run it. |

There is no macOS build.

### Windows: "Windows protected your PC"

The installer is not signed with a Windows code-signing certificate, so SmartScreen may block it the first time. To continue, click **More info**, then **Run anyway**.

### Linux: which distributions work

The AppImage is built on a rolling-release Arch-based system, and it uses your system's glibc. It needs glibc 2.44 or newer and a CPU with AVX2, so it runs on up-to-date rolling distributions such as Arch and CachyOS. On Ubuntu, Debian or Mint it may not start. Launch the AppImage file itself, from a folder you can write to, so the game can update it in place.

### Updates

The game looks for a new release when it starts and offers a one-click update: download, install, relaunch. You can also check by hand in Settings, under "Check for updates". Your saves are kept. This works for builds from `2026.1108.1` on; older builds (for example the portable zip) must be reinstalled once from the latest release.

### What's new

[`CHANGELOG.md`](CHANGELOG.md) lists every release. The same notes are in the game's patch-notes panel.

### Something went wrong?

The bug button in the game saves a ZIP file with your description of the problem and your save game, then opens the folder where it is. Send that file along when you report the problem: with the save, the problem can be reproduced.

### Linux: blank or flickering window

On Linux the game asks, the first time it starts, how it should draw its window: **Fast** (recommended, uses the graphics card) or **Compatibility** (slower, most of all in fullscreen, but it avoids drawing problems seen with some graphics drivers on Wayland). Tick "remember my choice" to stop being asked; otherwise it asks again at the next start. You can change the choice at any time in Settings, under "Graphics mode" (it applies the next time you open the game).

If the window flickers, draws wrongly or stays blank, choose Compatibility. As a last resort, and for scripts, you can start the game with the variable set; when it is set the game never asks and never overrides it:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 <command that starts the game>   # compatibility rendering
WEBKIT_DISABLE_DMABUF_RENDERER=0 <command that starts the game>   # accelerated rendering
```

---

# For contributors

## Requirements

| Technology | Version | Notes |
|------------|---------|-------|
| Rust | **1.85+** | The workspace root uses edition 2021; `olm_core` uses edition 2024, which needs 1.85 |
| Node.js | **22** | The version CI uses (`package.json` sets no `engines`) |
| Tauri CLI | **2.x** | Comes from npm (`@tauri-apps/cli`), so there is nothing to install separately |

You also need the system libraries Tauri requires on your OS: see the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).

## Run the game in development

```bash
git clone --recurse-submodules https://github.com/ProphetLemon/OLManager.git
cd OLManager
npm ci
npm run tauri dev
```

The game data in `data/` is a git submodule (the original project's `olmanager-data` repository). In a clone made without `--recurse-submodules`, run `git submodule update --init` once.

## Checks

Run these before opening a change:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
npm test
npm run build:types
```

Heavier checks, which the project still tracks as known debt:

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

> Do not run production Tauri bundle builds as part of normal validation. Packaging belongs to the release process: [`docs/RELEASING-FORK.md`](docs/RELEASING-FORK.md).

## Project structure

```
OLManager/
├── src/                      # Frontend (React + TypeScript)
│   ├── main.tsx              # Entry point, renders AppV2
│   ├── ui-v2/                # The only UI: shell, dashboard tabs, pages, primitives
│   │   └── _legacy/          # Old v1 code that the v2 wrappers still use
│   ├── lib/                  # Pure helpers
│   ├── store/                # State (Zustand)
│   ├── services/ api/        # Calls to the Rust backend
│   ├── hooks/ context/       # Shared hooks and React context
│   ├── i18n/                 # Translations (8 locales)
│   └── themes/               # Design tokens
│
├── src-tauri/                # Backend (Rust)
│   ├── src/                  # Tauri commands and setup
│   ├── crates/olm_core/      # Core game logic
│   ├── databases/            # World data
│   └── tauri.conf.json       # Tauri and updater config
│
├── assets/                   # Simulation data, draft data, updater public key
├── data/                     # Game data (pinned separately)
├── scripts/                  # Data and release scripts
├── docs/                     # Documentation
├── CHANGELOG.md
└── LICENSE
```

## Code conventions

### Rust

- **Crates:** lowercase with underscores (for example `olm_core`)
- **Types:** PascalCase. **Functions:** snake_case. **Enum variants:** PascalCase (`LolRole::Support`)
- **Errors:** custom error types with `thiserror`

### TypeScript / React

- **Components:** PascalCase (`PlayerCard`). **Hooks:** `use` prefix (`usePlayerData`)
- **Files:** PascalCase for components, camelCase for utilities
- **Design:** use theme tokens, never raw colours. The rules are in [`AGENTS.md`](AGENTS.md).

### Commits

Conventional Commits: `<type>(<scope>): <description>`.

```bash
feat(player): add LolRole assignment
fix(scouting): correct rating calculation
docs(readme): update the project structure
```

## Branches and contributing

The fork uses gitflow: `main` holds tagged releases and `develop` holds the next release.

1. Branch from `develop` as `<type>/<topic>`, for example `fix/match-nexus-defence`.
2. Commit with Conventional Commits.
3. Merge into `develop` with `--no-ff`.

The full branch table and the release steps are in [`docs/RELEASING-FORK.md`](docs/RELEASING-FORK.md).

## Documentation

- [`docs/README.md`](docs/README.md): documentation index
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): React/Tauri boundary, Rust crates, persistence, testing
- [`docs/RELEASING-FORK.md`](docs/RELEASING-FORK.md): branches, versions, building and publishing a release
- [`docs/UPDATER_SETUP.md`](docs/UPDATER_SETUP.md): how the auto-updater is set up
- [`docs/SCRIMS.md`](docs/SCRIMS.md): how scrims work
- [`docs/STAT_RATINGS.md`](docs/STAT_RATINGS.md): how player ratings are derived
- [`AGENTS.md`](AGENTS.md): UI v2 layout and design rules
- [`SECURITY.md`](SECURITY.md): vulnerability reporting

---

## License and Lineage

This repository is licensed under the **GNU General Public License v3.0**. See [`LICENSE`](LICENSE).

Code and assets inherited from OpenFootManager are treated as GPL-3.0-compatible unless a later audit documents otherwise. Third-party datasets, generated caches, and source-derived content such as Leaguepedia data are **not** automatically GPL by inheritance; they require separate provenance, attribution, and redistribution review. See [`docs/DATA_PROVENANCE.md`](https://github.com/ProphetLemon/OLManager/blob/c63d7e9f/docs/DATA_PROVENANCE.md) (removed from the tree by the original project in June 2026; the link is its last version).

### Riot Games

Open League Manager is not endorsed or sponsored by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc. This is a free, non-commercial fan project.

### Team marks and player images

Team names, team logos and player photos belong to their respective owners. Open League Manager is an unofficial, non-commercial fan project and is not affiliated with or endorsed by those teams, leagues or players.

### Third-party data credits

Player ratings in new games are derived from pro match statistics from [Leaguepedia](https://lol.fandom.com), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Method and refresh steps: [`docs/STAT_RATINGS.md`](docs/STAT_RATINGS.md). Whether ShareAlike applies to the derived rating asset is an open question for the owner.

The item catalogue and champion kits under `assets/simulation/` (`items.v1.json`, `champion-kits.v1.json`) and the item, summoner spell and ability icons come from Riot Games' [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon). The champion builds and presence in `assets/simulation/champion-builds.v1.json` are aggregated from professional match data from [Leaguepedia](https://lol.fandom.com), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); that file is offered under the same licence. How to refresh them: [`scripts/game-data/README.md`](scripts/game-data/README.md).

---

## Resources

- **This fork:** [github.com/ProphetLemon/OLManager](https://github.com/ProphetLemon/OLManager)
- **Original project:** [github.com/OpenLeagueManager/OLManager](https://github.com/OpenLeagueManager/OLManager)
- **Tauri v2 docs:** [v2.tauri.app](https://v2.tauri.app/)
- **Rust docs:** [doc.rust-lang.org](https://doc.rust-lang.org/)
- **React docs:** [react.dev](https://react.dev/)

---

<i>Built with Rust + Tauri + React + TypeScript + Community + Passion</i>
