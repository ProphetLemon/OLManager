import { describe, expect, it } from "vitest";

import {
  assetUrl,
  buildLatestJson,
  buildReleaseNotes,
  encodeAssetName,
  findBundle,
  findInstaller,
  findOnPath,
  makensisCpu,
  parseArgs,
  publishCommands,
  releaseAssetName,
} from "../../../scripts/release/lib/forkRelease.mjs";

const SETUP = "Open League Manager_0.4.0_x64-setup.exe";
const APPIMAGE = "Open League Manager_0.4.0_amd64.AppImage";

describe("fork release helpers", () => {
  it("names the asset the way GitHub will store it", () => {
    expect(releaseAssetName(SETUP)).toBe("Open.League.Manager_0.4.0_x64-setup.exe");
  });

  it("encodes spaces and reserved characters in the asset URL", () => {
    expect(encodeAssetName("Open League+1.exe")).toBe("Open%20League%2B1.exe");
    expect(assetUrl("ProphetLemon/OLManager", "0.4.0", "A B.exe")).toBe(
      "https://github.com/ProphetLemon/OLManager/releases/download/v0.4.0/A%20B.exe",
    );
  });

  it("finds the installer of the requested version and its signature", () => {
    const files = [
      "Open League Manager_0.3.1_x64-setup.exe",
      "Open League Manager_0.3.1_x64-setup.exe.sig",
      SETUP,
      `${SETUP}.sig`,
    ];
    expect(findInstaller(files, "0.4.0")).toEqual({ setup: SETUP, sig: `${SETUP}.sig` });
  });

  it("refuses an unsigned or missing installer", () => {
    expect(() => findInstaller([SETUP], "0.4.0")).toThrow(/Missing .*\.sig/);
    expect(() => findInstaller(["readme.txt"], "0.4.0")).toThrow(/No \*-setup\.exe/);
    expect(() => findInstaller([SETUP, SETUP.replace("Open", "Open2"), `${SETUP}.sig`], "0.4.0")).toThrow(
      /More than one/,
    );
  });

  it("finds the AppImage of the requested version and its signature", () => {
    const files = [
      "Open League Manager_0.3.1_amd64.AppImage",
      "Open League Manager_0.3.1_amd64.AppImage.sig",
      APPIMAGE,
      `${APPIMAGE}.sig`,
    ];
    expect(findBundle(files, "0.4.0", ".AppImage")).toEqual({ file: APPIMAGE, sig: `${APPIMAGE}.sig` });
  });

  it("refuses an unsigned, missing or ambiguous AppImage", () => {
    expect(() => findBundle([APPIMAGE], "0.4.0", ".AppImage")).toThrow(/Missing .*\.AppImage\.sig/);
    expect(() => findBundle([`${APPIMAGE}.sig`], "0.4.0", ".AppImage")).toThrow(/No \*\.AppImage/);
    expect(() =>
      findBundle([APPIMAGE, APPIMAGE.replace("Open", "Open2"), `${APPIMAGE}.sig`], "0.4.0", ".AppImage"),
    ).toThrow(/More than one/);
  });

  it("builds a Tauri v2 static latest.json", () => {
    const json = buildLatestJson({
      version: "0.4.0",
      notes: "notes",
      pubDate: "2026-11-08T10:00:00.000Z",
      platforms: [
        {
          platform: "windows-x86_64",
          signature: "  c2lnbmF0dXJl\n",
          assetName: "Open.League.Manager_0.4.0_x64-setup.exe",
        },
      ],
    });
    expect(json).toEqual({
      version: "0.4.0",
      notes: "notes",
      pub_date: "2026-11-08T10:00:00.000Z",
      platforms: {
        "windows-x86_64": {
          signature: "c2lnbmF0dXJl",
          url: "https://github.com/ProphetLemon/OLManager/releases/download/v0.4.0/Open.League.Manager_0.4.0_x64-setup.exe",
        },
      },
    });
  });

  it("lists one entry per platform in latest.json", () => {
    const json = buildLatestJson({
      version: "0.4.0",
      notes: "notes",
      pubDate: "2026-11-08T10:00:00.000Z",
      platforms: [
        { platform: "windows-x86_64", signature: "d2lu", assetName: "Open.League.Manager_0.4.0_x64-setup.exe" },
        { platform: "linux-x86_64", signature: " bGludXg=\n", assetName: "Open.League.Manager_0.4.0_amd64.AppImage" },
      ],
    });
    expect(Object.keys(json.platforms)).toEqual(["windows-x86_64", "linux-x86_64"]);
    expect(json.platforms["linux-x86_64"]).toEqual({
      signature: "bGludXg=",
      url: "https://github.com/ProphetLemon/OLManager/releases/download/v0.4.0/Open.League.Manager_0.4.0_amd64.AppImage",
    });
    expect(json.platforms["windows-x86_64"].signature).toBe("d2lu");
  });

  it("prints publish commands without running them", () => {
    const cmds = publishCommands({
      version: "0.4.0",
      files: ["a.exe", "latest.json"],
      notesFile: "RELEASE_NOTES.md",
    });
    expect(cmds[0]).toBe("git tag v0.4.0");
    expect(cmds[1]).toBe("git push origin v0.4.0");
    expect(cmds[2]).toContain("gh release create v0.4.0 --repo ProphetLemon/OLManager");
    expect(cmds[2]).toContain('"a.exe" "latest.json"');
    expect(cmds[2]).toContain('--notes-file "RELEASE_NOTES.md"');
  });

  it("writes release notes from commit subjects", () => {
    const notes = buildReleaseNotes({ version: "0.4.0", commits: ["feat: a", "fix: b"], previousTag: "v0.3.1" });
    expect(notes).toContain("Changes since v0.3.1");
    expect(notes).toContain("- feat: a\n- fix: b");
  });

  it("parses flags and rejects unknown ones", () => {
    expect(parseArgs(["--dry-run", "--notes", "n.md"])).toEqual({
      dryRun: true,
      notesFile: "n.md",
      repo: "ProphetLemon/OLManager",
    });
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--repo", "nope"])).toThrow(/Invalid --repo/);
  });

  it("probes PATH for a binary", () => {
    const exists = (p: string) => p === "/opt/bin/makensis";
    expect(findOnPath("makensis", "/usr/bin:/opt/bin", exists)).toBe("/opt/bin/makensis");
    expect(findOnPath("makensis", "/usr/bin", exists)).toBeNull();
  });

  it("reads the makensis target CPU from -HDRINFO", () => {
    // Tauri's installer script loads the 32-bit nsis_tauri_utils plugin, so only an x86 makensis works.
    expect(makensisCpu("Defined symbols: __GLOBAL__,NSIS_CHAR_SIZE=2,NSIS_CPU=x86,NSIS_IX86=400")).toBe("x86");
    expect(makensisCpu("Defined symbols: NSIS_AMD64=1,NSIS_CHAR_SIZE=2,NSIS_CPU=amd64")).toBe("amd64");
    expect(makensisCpu("Defined symbols: NSIS_AMD64=1,NSIS_CHAR_SIZE=2")).toBe("amd64");
    expect(makensisCpu("")).toBeNull();
  });
});
