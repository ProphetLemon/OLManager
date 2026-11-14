import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { KEY_EVENTS } from "@/lib/match/live/postGameFixtures.testing";
import { buildTimeline } from "@/lib/match/live/postGameTimeline";

import { PostGameTimeline } from "./PostGameTimeline";

afterAll(async () => {
  await i18n.changeLanguage("en");
});

const roster = [
  { id: "b-adc", name: "Paduck", team: "blue" as const },
  { id: "b-jgl", name: "Sheo", team: "blue" as const },
  { id: "r-top", name: "Myrwn", team: "red" as const },
];
const PICKS = { "b-adc": "Jinx", "r-top": "Gnar" };

const show = (complete = true, partialFromSec: number | null = null, events = KEY_EVENTS) =>
  render(<PostGameTimeline entries={buildTimeline(events, { complete, roster })} championByPlayerId={PICKS} partialFromSec={partialFromSec} />);

describe("PostGameTimeline", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("lists the key events in time order, each with its time, an icon and the live feed's sentence", () => {
    show();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(KEY_EVENTS.length);
    expect(within(rows[0]).getByText("2:20")).toBeInTheDocument();
    expect(within(rows[0]).getByText("First Blood: Paduck eliminated Supa")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Sheo eliminated Alvaro")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Blue secured the Ocean Dragon")).toBeInTheDocument();
    const times = rows.map((row) => row.querySelector("time")!.textContent);
    expect(times).toEqual([...times].sort((a, b) => Number(a.replace(":", "")) - Number(b.replace(":", ""))));
  });

  it("shows the killer's portrait for a kill and the map's own icon for an objective or a structure", () => {
    show();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].querySelector(".pg-event-icon img")).toHaveAttribute("src", "/champion-tiles/Jinx.webp");
    expect(rows[2].querySelector(".pg-event-icon img")).toHaveAttribute("src", "/lol-map-icons/dragon_ocean.webp");
    expect(rows[4].querySelector(".pg-event-icon img")).toHaveAttribute("src", "/lol-map-icons/tower_blue.webp");
  });

  it("marks first blood, Baron and the nexus as the events to look at", () => {
    show();
    const big = screen.getAllByRole("listitem").filter((row) => row.hasAttribute("data-big"));
    expect(big.map((row) => row.getAttribute("data-kind"))).toEqual(["firstBlood", "baron", "nexus"]);
  });

  it("does not call a kill first blood in a match that was skipped, and says from when events may be missing", () => {
    show(false, 600);
    expect(screen.queryByText(/First Blood/)).not.toBeInTheDocument();
    expect(screen.getByTestId("timeline-partial")).toHaveTextContent("This match was skipped from 10:00: events after it may be missing.");
  });

  it("says the events were not recorded in full when the match has no record", () => {
    show(false, 0);
    expect(screen.getByTestId("timeline-partial")).toHaveTextContent("The events of this match were not recorded in full.");
  });

  it("says so when there is nothing to list", () => {
    show(true, null, []);
    expect(screen.getByText("No key events were recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("runs in two columns, named by the time they cover, when there are many events", () => {
    show();
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(lists[0]).toHaveAccessibleName("Key events, 2:20 to 14:41");
  });

  it("writes the sentences in the language of the screen", async () => {
    await i18n.changeLanguage("es");
    show();
    expect(screen.getByText("Primera sangre: Paduck eliminó a Supa")).toBeInTheDocument();
    expect(screen.queryByText(/eliminated|secured/)).toBeNull();
  });
});
