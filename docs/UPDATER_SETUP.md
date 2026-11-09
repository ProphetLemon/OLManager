# Auto-updater setup

> The updater for this fork is documented in [RELEASING-FORK.md](RELEASING-FORK.md). This file only summarises it.
>
> El actualizador de este fork está documentado en [RELEASING-FORK.md](RELEASING-FORK.md). Este archivo solo lo resume.

- **Endpoint**: `https://github.com/ProphetLemon/OLManager/releases/latest/download/latest.json`
  (`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`).
- **Private key**: `~/.config/olmanager/tauri-updater.key`. It never goes in the repo.
- **Public key**: `assets/updater/olmanager-updater.pub`, copied into `plugins.updater.pubkey`; a test keeps both equal.
- **Release**: `npm run release:fork` (signs locally, writes `latest.json` and the installer).
  The upstream `OpenLeagueManager/OLManager` repository, its keys and its `latest.json` are not used by this fork.
