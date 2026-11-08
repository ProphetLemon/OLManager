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

## Build (Linux host: Windows x64 installer + Linux x64 AppImage)

Requirements: an x86 `makensis` (see below), `cargo-xwin`, the `x86_64-pc-windows-msvc` Rust target. The AppImage
is a native build on the Linux x86_64 host and needs nothing extra, but the first one downloads `linuxdeploy`
from GitHub, so it needs network access.

### x86 NSIS

The AUR `nsis` package is built with `TARGET_ARCH=amd64` only. Tauri's installer script calls the 32-bit
`nsis_tauri_utils` plugin, which an amd64 makensis cannot load, so the build fails with
`Plugin not found, cannot call nsis_tauri_utils::SemverCompare`. `release:fork` checks this up front.

Build an x86 NSIS once, in user space and without sudo. It needs `scons`, `mingw-w64-gcc` and `mingw-w64-zlib`, all
already pulled in by `paru -S nsis`. The source is the tarball paru downloaded:

```
P=~/.cache/olmanager/nsis-3.13-x86
mkdir -p ~/.cache/olmanager/build && tar -xjf ~/.cache/paru/clone/nsis/nsis-3.13-src.tar.bz2 -C ~/.cache/olmanager/build
cd ~/.cache/olmanager/build/nsis-3.13-src
scons VERSION=3.13 PREFIX=$P PREFIX_CONF=$P/etc SKIPUTILS='NSIS Menu' STRIP_CP=false TARGET_ARCH=x86 \
  ZLIB_W32=/usr/i686-w64-mingw32/ NSIS_MAX_STRLEN=8192 NSIS_CONFIG_LOG=yes PREFIX_DEST= install
```

Run scons without `-j`: a parallel install races on two bitmap files. The data path is compiled in, so do not move
`$P` afterwards. Then release with it first on PATH:
`PATH=~/.cache/olmanager/nsis-3.13-x86/bin:$PATH npm run release:fork`.

1. Set the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` (then let any cargo command
   refresh `Cargo.lock`), `src-tauri/tauri.conf.json` (also the window title), `src/lib/common/appInfo.ts` and
   the `CHANGELOG.md` heading. `src/lib/release/releaseConfig.test.ts` checks that they match and follow the scheme.
2. `npm run release:fork -- --dry-run` checks the tools and key and shows the plan without building.
3. `npm run release:fork` builds the NSIS installer, then the AppImage, both signed with the same key, and writes
   `src-tauri/target/fork-release/v<version>/` with both files, a single `latest.json` (`windows-x86_64` and
   `linux-x86_64`) and `RELEASE_NOTES.md`. It fails if either build or either `.sig` is missing. Use `--notes notes.md` to supply your own notes.

The assets are named with dots instead of spaces (`Open.League.Manager_<v>_x64-setup.exe` and
`Open.League.Manager_<v>_amd64.AppImage`), which is what GitHub stores, so the URLs in `latest.json` match the
real assets.

## Publish

The script only prints these commands; run them yourself once you are happy:

```
git tag v<version>
git push origin v<version>
gh release create v<version> --repo ProphetLemon/OLManager --title "Open League Manager <version>" \
  --notes-file <dir>/RELEASE_NOTES.md <dir>/<installer> <dir>/<appimage> <dir>/latest.json
```

Once the release is the latest one, every installed build from 2026.1108.1 on offers it at the next start (or from
Settings, "Check for updates"). Saves are kept. Before the first release exists, the check just finds nothing
and shows no error.

## Linux players

Download `Open.League.Manager_<v>_amd64.AppImage`, `chmod +x` it and run it directly. The updater replaces that
file in place, so always launch the AppImage itself (not an extracted copy), from a location the user can write to.

Portability: an AppImage bundles the build host's libraries but uses the player's glibc. Built on this CachyOS
host it needs glibc 2.44 or newer (checked with `objdump -T` on the extracted AppImage), so it only runs on
up-to-date rolling distros (Arch, CachyOS and similar). The bundled libraries come from the `cachyos-v3` repos,
which are built for x86-64-v3, so expect an AVX2 CPU too. For Ubuntu, Debian or Mint players, build the
AppImage on an older base (for example an Ubuntu 22.04 container or CI runner) instead.

`release:fork` sets `NO_STRIP=true` for the AppImage build. linuxdeploy ships an old `strip` that fails on
current distro libraries with "unknown type [0x13] section `.relr.dyn'".

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
