#!/usr/bin/env node
// Builds the signed Windows x64 NSIS installer from Linux and stages a GitHub
// release (installer, latest.json, RELEASE_NOTES.md). It never publishes: the
// final git/gh commands are only printed, because publishing is a remote
// operation the owner authorizes separately.
//
//   npm run release:fork -- --dry-run     plan and checks, no build
//   npm run release:fork                  build + stage
//   npm run release:fork -- --notes n.md  use n.md as the release notes
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NSIS_HINT,
  WINDOWS_TARGET,
  buildLatestJson,
  buildReleaseNotes,
  findInstaller,
  findOnPath,
  parseArgs,
  publishCommands,
  releaseAssetName,
  tagFor,
} from "./lib/forkRelease.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const keyPath = join(homedir(), ".config", "olmanager", "tauri-updater.key");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf-8"));
const version = pkg.version;
const nsisDir = join(root, "src-tauri", "target", WINDOWS_TARGET, "release", "bundle", "nsis");
const outDir = join(root, "src-tauri", "target", "fork-release", tagFor(version));

function fail(message) {
  console.error(`release:fork: ${message}`);
  process.exit(1);
}

function git(...args) {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf-8" });
  return res.status === 0 ? res.stdout.trim() : "";
}

function previousTag() {
  return git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD") || null;
}

function releaseNotes(opts) {
  if (opts.notesFile) {
    const file = resolve(process.cwd(), opts.notesFile);
    if (!existsSync(file)) fail(`notes file not found: ${file}`);
    return readFileSync(file, "utf-8");
  }
  const tag = previousTag();
  const range = tag ? [`${tag}..HEAD`] : ["-n", "30"];
  const commits = git("log", "--no-merges", "--pretty=format:%s", ...range).split("\n").filter(Boolean);
  return buildReleaseNotes({ version, commits, previousTag: tag });
}

const opts = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (err) {
    return fail(err.message);
  }
})();

const checks = [
  ["makensis", Boolean(findOnPath("makensis")), NSIS_HINT],
  ["cargo-xwin", Boolean(findOnPath("cargo-xwin") || existsSync(join(homedir(), ".cargo", "bin", "cargo-xwin"))), "install it: cargo install cargo-xwin"],
  ["updater private key", existsSync(keyPath), `generate it: npx tauri signer generate -w ${keyPath} --ci`],
];

console.log(`release:fork: ${conf.productName} ${version} -> ${opts.repo} (${WINDOWS_TARGET})`);
for (const [name, ok, hint] of checks) console.log(`  ${ok ? "ok     " : "MISSING"} ${name}${ok ? "" : ` (${hint})`}`);

if (opts.dryRun) {
  const expected = releaseAssetName(`${conf.productName}_${version}_x64-setup.exe`);
  console.log(`\nDry run: stopping before the build. Would write to ${outDir}:`);
  console.log(`  ${expected}\n  latest.json\n  RELEASE_NOTES.md`);
  console.log("\nPublish commands (printed, never run by this script):");
  for (const cmd of publishCommands({ version, repo: opts.repo, files: [expected, "latest.json"], notesFile: "RELEASE_NOTES.md" })) {
    console.log(`  ${cmd}`);
  }
  process.exit(0);
}

// makensis first: without it the bundler fails with a confusing message.
if (!checks[0][1]) fail(`makensis is not on PATH. ${NSIS_HINT}`);
if (!checks[1][1]) fail(checks[1][2]);
if (!checks[2][1]) fail(`updater private key not found at ${keyPath}. ${checks[2][2]}`);

// The key goes to the child through its environment only; it is never printed.
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, "utf-8"),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
};
// beforeBuildCommand in tauri.conf.json already runs scripts/sync-data.mjs.
const build = spawnSync(
  "npm",
  ["run", "tauri", "--", "build", "--runner", "cargo-xwin", "--target", WINDOWS_TARGET, "--bundles", "nsis"],
  { cwd: root, env, stdio: "inherit" },
);
if (build.status !== 0) fail(`the build failed (exit ${build.status ?? "signal"}).`);

let found;
try {
  found = findInstaller(readdirSync(nsisDir), version);
} catch (err) {
  fail(err.message);
}

const assetName = releaseAssetName(found.setup);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
copyFileSync(join(nsisDir, found.setup), join(outDir, assetName));

const notes = releaseNotes(opts);
writeFileSync(join(outDir, "RELEASE_NOTES.md"), notes);
const latest = buildLatestJson({
  version,
  notes,
  pubDate: new Date().toISOString(),
  signature: readFileSync(join(nsisDir, found.sig), "utf-8"),
  assetName,
  repo: opts.repo,
});
writeFileSync(join(outDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);

console.log(`\nrelease:fork: staged ${tagFor(version)} in ${outDir}`);
console.log("Publish commands (not run; publishing is your call):");
for (const cmd of publishCommands({
  version,
  repo: opts.repo,
  files: [join(outDir, assetName), join(outDir, "latest.json")],
  notesFile: join(outDir, "RELEASE_NOTES.md"),
})) {
  console.log(`  ${cmd}`);
}
