# Releasing the fork

The game checks `https://github.com/ProphetLemon/OLManager/releases/latest/download/latest.json`
on startup (release builds only) and offers a one-click update: download, install, relaunch.
Updates are accepted only when signed with our own key.

## Signing key

- Private key: `~/.config/olmanager/tauri-updater.key` (mode 0600, empty password). It never goes in the repo.
- Public key: `assets/updater/olmanager-updater.pub`, copied into `plugins.updater.pubkey` in
  `src-tauri/tauri.conf.json`. A test keeps both equal.
- Back the private key up somewhere safe. If it is lost, no installed build can ever accept an update again;
  everyone has to reinstall by hand with a build that embeds a new public key.

To create a key (only if none exists): `npx tauri signer generate -w ~/.config/olmanager/tauri-updater.key --ci`,
then `chmod 600` it and replace the committed public key.

## Build (Linux, cross-compiling for Windows x64)

Requirements: `makensis` (`paru -S nsis`), `cargo-xwin`, the `x86_64-pc-windows-msvc` Rust target.

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (also the window
   title) and `src/lib/common/appInfo.ts`. Use a plain `X.Y.Z`: semver ranks `0.4.0-rc1` below `0.3.1`.
2. `npm run release:fork -- --dry-run` checks the tools and key and shows the plan without building.
3. `npm run release:fork` builds the NSIS installer, then writes `src-tauri/target/fork-release/v<version>/`
   with the installer, `latest.json` and `RELEASE_NOTES.md`. Use `--notes notes.md` to supply your own notes.

The installer is named with dots instead of spaces (`Open.League.Manager_<v>_x64-setup.exe`), which is what
GitHub stores, so the URL in `latest.json` matches the real asset.

## Publish

The script only prints these commands; run them yourself once you are happy:

```
git tag v<version>
git push origin v<version>
gh release create v<version> --repo ProphetLemon/OLManager --title "Open League Manager <version>" \
  --notes-file <dir>/RELEASE_NOTES.md <dir>/<installer> <dir>/latest.json
```

Once the release is the latest one, every installed build from 0.4.0 on offers it at the next start (or from
Settings, "Check for updates"). Saves are kept. Before the first release exists, the check just finds nothing
and shows no error.

## One-time migration for the friend

The portable zip (built with `--no-bundle`) has no installer and embeds upstream's public key, so it cannot
install our updates. Once:

1. Close the game. Copy the saves folder if you want a backup.
2. Run the `...-setup.exe` from the first fork release. It installs per user and keeps the saves.
3. Delete the old portable folder. From then on the game updates itself.

## CI

`.github/workflows/release.yml` builds asset URLs from `github.repository`, so it works on the fork, but it
needs the signing secrets and the pinned `data` commit to be reachable on GitHub. The local script does not.

The workflow signs with the CI secrets (`TAURI_SIGNING_PRIVATE_KEY` and its password), not with
`~/.config/olmanager/tauri-updater.key`. A CI-built release only updates installed builds if those secrets hold
the same key as `assets/updater/olmanager-updater.pub`; otherwise every signature is rejected. The supported
path is `npm run release:fork`.
