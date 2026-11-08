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

## Version scheme

Releases use a calendar version, `YYYY.MMDD.N`: the year, then month and day as one number, then a counter
that starts at 1 for each day.

| Release | Version |
|---|---|
| 8 November 2026, first build | `2026.1108.1` |
| 8 November 2026, second build | `2026.1108.2` |
| 11 January 2027 | `2027.111.1` |
| 1 November 2027 | `2027.1101.1` |

- The middle number is `month * 100 + day`. The day always keeps two digits, so `111` can only be 11 January and
  1 November is `1101`. Only the month loses its leading zero.
- The updater, Cargo and npm compare versions as semver, which forbids leading zeros. So `2026.11.08.1` is not a
  valid version.
- Never add a suffix. `2026.1108.1-2` is a semver prerelease and ranks below `2026.1108.1`, and anything after `+`
  is ignored when comparing. In both cases installed builds would not see the new release.
- The MSI bundle is not built: its version fields stop at 255, so they cannot hold the year. `bundle.targets`
  lists every other format.
- Android computes `versionCode = major * 1000000 + minor * 1000 + patch` by default. That breaks the order
  across years, because `2027.111.1` would get a lower code than `2026.1231.1`. Set `bundle.android.versionCode`
  by hand before shipping an APK.

## Build (Linux, cross-compiling for Windows x64)

Requirements: `makensis` (`paru -S nsis`), `cargo-xwin`, the `x86_64-pc-windows-msvc` Rust target.

1. Set the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` (then let any cargo command
   refresh `Cargo.lock`), `src-tauri/tauri.conf.json` (also the window title), `src/lib/common/appInfo.ts` and
   the `CHANGELOG.md` heading. `src/lib/release/releaseConfig.test.ts` checks that they match and follow the scheme.
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

Once the release is the latest one, every installed build from 2026.1108.1 on offers it at the next start (or from
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
