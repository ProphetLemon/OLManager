import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { endSummary } from "@/lib/match/live/endSummary";
import type { LaneView } from "@/lib/match/live/laneStrip";
import { buildScoreboard, keyEventsOf } from "@/lib/match/live/postGame";
import { finishedMatch } from "@/lib/match/live/postGameFixtures.testing";
import { buildTimeline } from "@/lib/match/live/postGameTimeline";
import { teamIdentity } from "@/lib/match/live/teamIdentity";

import { EndPanel } from "./live/EndPanel";
import { LaneStrip } from "./live/LaneStrip";
import { TagContent } from "./live/TagContent";
import { NAME_LANG, NAME_SLOT, Name, NameIn } from "./NameText";
import { PostGameGraphs } from "./post/PostGameGraphs";
import { PostGameScoreboard } from "./post/PostGameScoreboard";

/**
 * With `lang="tr"` on the page, `text-transform: uppercase` turns the "i" of a handle or a club name
 * into "İ". The words of the UI keep Turkish casing; a name must not, so every name that a screen
 * of the match shows in capitals sits in an element whose own `lang` is the neutral one.
 */

beforeAll(async () => {
  await i18n.changeLanguage("tr");
  document.documentElement.lang = "tr";
});
afterAll(async () => {
  await i18n.changeLanguage("en");
  document.documentElement.lang = "";
});

const BLUE = teamIdentity("Gümüş Aslanlar", [{ name: "Gümüş Aslanlar", short_name: "GUMI" }]);
const RED = teamIdentity("Tidal Lanterns", [{ name: "Tidal Lanterns", short_name: "TDL" }]);

/** The language that applies to a node: the nearest `lang` up the tree. */
const langOf = (node: Element) => node.closest("[lang]")?.getAttribute("lang");
const nameLang = (el: HTMLElement) => langOf(el);

describe("Name and NameIn", () => {
  it("puts the neutral language on a name", () => {
    render(<Name>GUMAYUSİ</Name>);
    expect(nameLang(screen.getByText("GUMAYUSİ"))).toBe(NAME_LANG);
    expect(NAME_LANG).toBe("und");
  });

  it("keeps the words around a name in the language of the page and puts only the name apart", () => {
    const { container } = render(<p>{<NameIn text={`${NAME_SLOT} itiyor`} name="Gumayusi" />}</p>);
    expect(container.textContent).toBe("Gumayusi itiyor");
    expect(nameLang(screen.getByText("Gumayusi"))).toBe(NAME_LANG);
    expect(container.querySelector("[lang]")?.textContent).toBe("Gumayusi");
    expect(langOf(container.querySelector("p")!)).toBe("tr");
  });

  it("shows a sentence whole when its translation lost the slot", () => {
    const { container } = render(<p>{<NameIn text="kimse itmiyor" name="Gumayusi" />}</p>);
    expect(container.textContent).toBe("kimse itmiyor");
  });
});

describe("the live screen in Turkish", () => {
  it("marks the map tag's name", () => {
    const { container } = render(<TagContent name="Gumayusi" texts={{ sub: "", subCompact: "" }} />);
    const spans = container.querySelectorAll("b span");
    expect(spans.length).toBeGreaterThan(0);
    for (const el of spans) expect(langOf(el)).toBe(NAME_LANG);
  });

  it("marks the club in the lane strip's push line", () => {
    const lanes: LaneView[] = [{ lane: "top", push: "blue", front: 0.7, fight: false }];
    const { container } = render(<LaneStrip lanes={lanes} blue={BLUE} red={RED} />);
    const text = container.querySelector(".arena-lane-text") as HTMLElement;
    expect(text).toHaveTextContent("GUMI itiyor");
    expect(nameLang(within(text).getByText("GUMI"))).toBe(NAME_LANG);
    expect(langOf(text)).toBe("tr");
  });

  it("marks the winner in the end panel's result", () => {
    const summary = endSummary({ winner: "red", timeSec: 1900, stats: { blue: { kills: 3, gold: 100 }, red: { kills: 9, gold: 300 } } })!;
    render(<EndPanel summary={summary} blue={BLUE} red={RED} onContinue={vi.fn()} />);
    const heading = screen.getByRole("heading");
    expect(nameLang(within(heading).getByText("Tidal Lanterns"))).toBe(NAME_LANG);
  });
});

describe("the post-game screen in Turkish", () => {
  const state = finishedMatch();
  const board = buildScoreboard(state);

  it("marks the club tag and name in each scoreboard head and every player handle", () => {
    const { container } = render(<PostGameScoreboard board={board} blue={BLUE} red={RED} championByPlayerId={{}} itemNames={{}} />);
    for (const text of [BLUE.tag, BLUE.name, RED.tag, RED.name]) {
      const heads = [...container.querySelectorAll(".pg-team")].flatMap((head) => [...head.querySelectorAll("b, span")].filter((el) => el.textContent === text));
      expect(heads.length, text).toBeGreaterThan(0);
      for (const el of heads) expect(langOf(el), text).toBe(NAME_LANG);
    }
    const handles = container.querySelectorAll(".pg-player-text b");
    expect(handles.length).toBeGreaterThan(0);
    for (const el of handles) expect(el).toHaveAttribute("lang", NAME_LANG);
  });

  it("marks the tags and names the graphs show in capitals", () => {
    const roster = [...board.rows.blue, ...board.rows.red].map((row) => ({ id: row.id, name: row.name, team: row.side }));
    const entries = buildTimeline(keyEventsOf(state), { complete: true, roster });
    const { container } = render(
      <PostGameGraphs board={board} record={state.matchRecord} entries={entries} blue={BLUE} red={RED} championByPlayerId={{}} />,
    );
    for (const tag of [BLUE.tag, RED.tag]) {
      const shown = [...container.querySelectorAll(".pg-legend *, .pg-group-head *, .pg-sidetag *")].filter((el) => el.children.length === 0 && el.textContent === tag);
      expect(shown.length, tag).toBeGreaterThanOrEqual(3);
      for (const el of shown) expect(langOf(el), tag).toBe(NAME_LANG);
    }
    for (const el of container.querySelectorAll(".pg-barrow-name")) expect(el).toHaveAttribute("lang", NAME_LANG);
  });
});
