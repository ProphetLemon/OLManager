import { describe, expect, it } from "vitest";

import { resolveTeamLogoById } from "./teamLogos";
import { resolveTransferTeamLogo } from "./transferLogos";

const BADGE = "data:image/svg+xml;utf8,%3Csvg%3E";
const teams = [
  { id: "les-custom-ray", name: "Ray Gaming", logo_url: BADGE },
  { id: "lec-g2", name: "G2 Esports", logo_url: "/teams-icons/g2-esports.webp" },
  { id: "lec-nologo", name: "No Logo", logo_url: null },
];

describe("resolveTeamLogoById", () => {
  it("prefers the team's own logo_url, data URIs included", () => {
    expect(resolveTeamLogoById(teams, "les-custom-ray", () => "/fallback.png")).toBe(BADGE);
  });

  it("uses the fallback for unknown teams or teams without a logo", () => {
    expect(resolveTeamLogoById(teams, "nope", () => "/fb.png")).toBe("/fb.png");
    expect(resolveTeamLogoById(teams, "lec-nologo", () => "/fb.png")).toBe("/fb.png");
    expect(resolveTeamLogoById(undefined, "x", () => "/fb.png")).toBe("/fb.png");
  });

  it("returns null without an id", () => {
    expect(resolveTeamLogoById(teams, "", () => "/fb.png")).toBeNull();
  });
});

describe("resolveTransferTeamLogo (market sites)", () => {
  it("shows the data: badge of a custom club instead of an id-derived path", () => {
    expect(resolveTransferTeamLogo(teams, "les-custom-ray", "Ray Gaming")).toBe(BADGE);
  });

  it("keeps the legacy id-derived path for teams without teams data", () => {
    expect(resolveTransferTeamLogo([], "lec-fnatic", "Fnatic")).toBe("/team-logos/fnatic.png");
    expect(resolveTransferTeamLogo(undefined, "lec-shifters", "Shifters")).toBe(
      "/teams-icons/shifters.webp",
    );
  });
});
