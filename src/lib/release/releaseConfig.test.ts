import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_VERSION } from "../common/appInfo";
import { APP_EDITION } from "../common/edition";

const root = resolve(__dirname, "../../..");
const readText = (rel: string) => readFileSync(resolve(root, rel), "utf-8");

const tauriConf = JSON.parse(readText("src-tauri/tauri.conf.json")) as {
  productName: string;
  version: string;
  app: { windows: { title: string }[] };
  bundle: { targets: string | string[] };
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

  it("shows the edition in the window and page titles but not in asset names", () => {
    expect(tauriConf.app.windows[0].title).toContain(APP_EDITION);
    expect(readText("index.html")).toContain(`<title>Open League Manager · ${APP_EDITION}</title>`);
    // productName names the installer and AppImage assets the updater downloads; keep it ASCII.
    expect(tauriConf.productName).toBe("Open League Manager");
  });

  it("uses a YYYY.MMDD.N calendar version that semver orders by date", () => {
    // No leading zeros (semver forbids them) and no prerelease suffix (it would rank below the plain release).
    const match = /^(\d{4})\.([1-9]\d{2,3})\.([1-9]\d*)$/.exec(pkg.version);
    expect(match, `${pkg.version} is not YYYY.MMDD.N`).not.toBeNull();
    const monthDay = Number(match?.[2]);
    const month = Math.floor(monthDay / 100);
    const day = monthDay % 100;
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it("skips the MSI bundle, whose version fields cannot hold a calendar year", () => {
    expect(Array.isArray(tauriConf.bundle.targets)).toBe(true);
    expect(tauriConf.bundle.targets).not.toContain("msi");
    expect(tauriConf.bundle.targets).toContain("nsis");
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
