import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_VERSION } from "../common/appInfo";

const root = resolve(__dirname, "../../..");
const readText = (rel: string) => readFileSync(resolve(root, rel), "utf-8");

const tauriConf = JSON.parse(readText("src-tauri/tauri.conf.json")) as {
  version: string;
  app: { windows: { title: string }[] };
  plugins: { updater: { pubkey: string; endpoints: string[] } };
};
const pkg = JSON.parse(readText("package.json")) as { version: string };
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(readText("src-tauri/Cargo.toml"))?.[1];

describe("release configuration", () => {
  it("keeps every version string in step", () => {
    expect(tauriConf.version).toBe(pkg.version);
    expect(cargoVersion).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
    expect(tauriConf.app.windows[0].title).toContain(pkg.version);
  });

  it("uses a plain semver version so a prerelease never ranks below an installed build", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("verifies updates with the committed fork public key", () => {
    const committed = readText("assets/updater/olmanager-updater.pub").trim();
    expect(committed.length).toBeGreaterThan(0);
    expect(tauriConf.plugins.updater.pubkey).toBe(committed);
    expect(Buffer.from(committed, "base64").toString("utf-8")).toContain("minisign public key");
  });

  it("looks for updates in the fork's releases", () => {
    expect(tauriConf.plugins.updater.endpoints).toEqual([
      "https://github.com/ProphetLemon/OLManager/releases/latest/download/latest.json",
    ]);
  });

  it("does not hardcode the upstream owner in the release workflow", () => {
    const workflow = readText(".github/workflows/release.yml");
    expect(workflow).not.toMatch(/github\.com\/OpenLeagueManager\/OLManager\/releases/);
  });
});
