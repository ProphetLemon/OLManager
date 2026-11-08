// Pure helpers for scripts/release/build-fork-release.mjs. No I/O besides the
// explicit `findOnPath` PATH probe, so they stay unit-testable.
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export const DEFAULT_REPO = "ProphetLemon/OLManager";
export const WINDOWS_TARGET = "x86_64-pc-windows-msvc";
export const UPDATER_PLATFORM = "windows-x86_64";
export const NSIS_HINT = "install NSIS: paru -S nsis";

/** GitHub rewrites spaces in uploaded asset names to dots; use that name up front so latest.json matches. */
export function releaseAssetName(fileName) {
  return fileName.trim().replace(/\s+/g, ".");
}

/** Percent-encodes one path segment, so `Name With Space.exe` can sit in a URL. */
export function encodeAssetName(assetName) {
  return encodeURIComponent(assetName);
}

export function tagFor(version) {
  return `v${version}`;
}

export function assetUrl(repo, version, assetName) {
  return `https://github.com/${repo}/releases/download/${tagFor(version)}/${encodeAssetName(assetName)}`;
}

/**
 * Picks the NSIS installer and its signature out of a directory listing.
 * Only the installer of `version` counts, so stale builds are never published.
 */
export function findInstaller(fileNames, version) {
  const setups = fileNames.filter(
    (name) => name.endsWith("-setup.exe") && name.includes(`_${version}_`),
  );
  if (setups.length === 0) {
    throw new Error(`No *-setup.exe for version ${version} in the NSIS bundle directory.`);
  }
  if (setups.length > 1) {
    throw new Error(`More than one installer for version ${version}: ${setups.join(", ")}`);
  }
  const setup = setups[0];
  const sig = `${setup}.sig`;
  if (!fileNames.includes(sig)) {
    throw new Error(
      `Missing ${sig}. The build was not signed: check TAURI_SIGNING_PRIVATE_KEY and bundle.createUpdaterArtifacts.`,
    );
  }
  return { setup, sig };
}

/** Tauri v2 static updater manifest. */
export function buildLatestJson({ version, notes, pubDate, signature, assetName, repo = DEFAULT_REPO }) {
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      [UPDATER_PLATFORM]: {
        signature: signature.trim(),
        url: assetUrl(repo, version, assetName),
      },
    },
  };
}

export function buildReleaseNotes({ version, commits, previousTag }) {
  const range = previousTag ? `since ${previousTag}` : "recent changes";
  const lines = commits.length > 0 ? commits.map((c) => `- ${c}`) : ["- No notable changes recorded."];
  return `# Open League Manager ${version}\n\nChanges ${range}:\n\n${lines.join("\n")}\n`;
}

export function publishCommands({ version, repo = DEFAULT_REPO, files, notesFile }) {
  const tag = tagFor(version);
  const quoted = files.map((f) => `"${f}"`).join(" ");
  return [
    `git tag ${tag}`,
    `git push origin ${tag}`,
    `gh release create ${tag} --repo ${repo} --title "Open League Manager ${version}" --notes-file "${notesFile}" ${quoted}`,
  ];
}

export function parseArgs(argv) {
  const opts = { dryRun: false, notesFile: null, repo: DEFAULT_REPO };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--notes") opts.notesFile = argv[++i] ?? null;
    else if (arg === "--repo") opts.repo = argv[++i] ?? DEFAULT_REPO;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`Invalid --repo: ${opts.repo}`);
  return opts;
}

export function findOnPath(binary, pathVar = process.env.PATH ?? "", exists = existsSync) {
  return pathVar
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, binary))
    .find((candidate) => exists(candidate)) ?? null;
}
