import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { endSummary } from "@/lib/match/live/endSummary";
import { teamIdentity } from "@/lib/match/live/teamIdentity";

import { EndPanel } from "./EndPanel";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const summary = endSummary({ winner: "red", timeSec: 1900, stats: { blue: { kills: 3, gold: 100 }, red: { kills: 9, gold: 300 } } })!;
const BLUE = { ...teamIdentity("Embers", [{ name: "Embers", short_name: "EMB" }]), logoUrl: "/teams-icons/embers.webp" };
const RED = teamIdentity("Tides", [{ name: "Tides", short_name: "TDE" }]);

describe("EndPanel in club colours", () => {
  it("shows the winner's crest beside the result, in the winner's side shape", () => {
    render(<EndPanel summary={summary} blue={BLUE} red={RED} onContinue={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const winnerRow = dialog.querySelector(".live-end-winner")!;
    const crest = winnerRow.querySelector(".arena-crest")!;
    expect(crest).toHaveAttribute("data-team", "red");
    expect(crest).toHaveAttribute("data-fallback", "true");
    expect(within(winnerRow as HTMLElement).getByRole("heading")).toHaveTextContent("Tides wins");
  });

  it("puts each club's logo in its column head, next to its tag", () => {
    render(<EndPanel summary={summary} blue={BLUE} red={RED} onContinue={vi.fn()} />);
    const blueHead = screen.getByRole("columnheader", { name: "EMB" });
    expect(blueHead.querySelector("img")).toHaveAttribute("src", "/teams-icons/embers.webp");
    expect(screen.getByRole("columnheader", { name: "TDE" })).toHaveAttribute("data-team", "red");
  });

  it("underlines each side's score with its club colour, solid for blue and dashed for red", () => {
    const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");
    expect(css).toMatch(/\.live-end-score \[data-team\],\s*\.live-end-stats th\[data-team\]\s*\{\s*border-bottom:\s*3px solid var\(--side-blue\)/);
    expect(css).toMatch(/\.live-end-stats th\[data-team="red"\]\s*\{\s*border-bottom:\s*3px dashed var\(--side-red\)/);
  });
});
