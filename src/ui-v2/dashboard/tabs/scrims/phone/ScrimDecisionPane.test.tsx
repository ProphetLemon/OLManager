import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { TeamIdentity } from "@/lib/teams/teamIdentity";
import { ScrimDecisionPane, type ScrimDecisionPaneProps } from "./ScrimDecisionPane";
import { makeOptions, makeReport } from "./scrimDayFixtures";
import { STATS } from "./PhoneStats";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const YOU: TeamIdentity = { name: "Mine Esports", tag: "MIN", logoUrl: null };
const RIVAL: TeamIdentity = { name: "UCAM Esports", tag: "UCAM", logoUrl: null };

function setup(props: Partial<ScrimDecisionPaneProps> = {}) {
  const onDecide = vi.fn();
  const onBack = vi.fn();
  const utils = render(
    <ScrimDecisionPane
      title="Decide Wed A"
      onBack={onBack}
      report={makeReport()}
      you={YOU}
      rival={RIVAL}
      blockLabel="A"
      options={makeOptions({ isFirstBlock: true, won: false })}
      savingId={null}
      onDecide={onDecide}
      reputation={30}
      locked
      {...props}
    />,
  );
  return { onDecide, onBack, ...utils };
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-slot="effects-row"]')];
const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}\\.`) }).closest("li") as HTMLElement;
const titles = () => rows().map((row) => row.querySelector("button span")?.textContent);
const cellKinds = (row: HTMLElement) => STATS.map((stat) => row.querySelector(`[data-stat="${stat}"] [data-slot="stat-value"]`)?.getAttribute("data-change"));
const pane = () => document.querySelector('[data-slot="scrim-decision-pane"]') as HTMLElement;

function closeDay(won: boolean) {
  const report = makeReport({ slot_index: 1, won, issue: won ? null : "LanePressure" });
  return { report, blockLabel: "B", title: "Decide Wed B", options: makeOptions({ isFirstBlock: false, won, report }) };
}

describe("ScrimDecisionPane: the frame", () => {
  it("draws the shared frame with one heading, the frame's title, and a back control that leaves for Semana", () => {
    const { onBack } = setup();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: /Decide Wed A/ })).toHaveAttribute("data-pane-heading", "");
    const back = screen.getByRole("button", { name: "Back: Decide Wed A" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("has no card around the whole view, no live region and nothing that scrolls", () => {
    const { container } = setup();
    expect(container.querySelector('[data-slot="scrim-view-body"]')?.className).not.toContain("bg-card");
    expect(container.querySelector("[aria-live]")).toBeNull();
    // The frame's body may scroll as a safety; nothing inside the pane does.
    expect(container.querySelector('[data-slot="scrim-decision-pane"]')!.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"], [class*="overflow-y-scroll"]')).toBeNull();
  });

  it("keeps the body inside the 286 px area: 8 px under the top row and the table down to the bottom edge (22 + 4 x 48 + 3 x 4 = 226)", () => {
    setup();
    expect(pane().className).toContain("pt-2");
    expect(pane().className).not.toContain("pb-");
    expect(pane().className).toContain("h-full");
  });

  it("shows the lock as its icon and the word Locked in the top row, never the sentence", () => {
    setup();
    const lock = document.querySelector('[data-slot="decision-lock"]') as HTMLElement;
    expect(lock).toHaveTextContent("Locked");
    expect(lock.querySelector("svg")).not.toBeNull();
    expect(document.querySelector('[data-slot="scrim-view-top"]')).toContainElement(lock);
    expect(screen.queryByText(/setup is locked/)).toBeNull();
  });

  it("draws no lock when the week is not locked", () => {
    setup({ locked: false });
    expect(document.querySelector('[data-slot="decision-lock"]')).toBeNull();
  });
});

describe("ScrimDecisionPane: the block", () => {
  it("tells the block as a matchup: your club and the rival, each with its logo and name", () => {
    setup();
    const matchup = document.querySelector('[data-slot="phone-matchup"]') as HTMLElement;
    const teams = within(matchup).getAllByRole("img");
    expect(teams.map((img) => img.getAttribute("aria-label"))).toEqual(["Mine Esports", "UCAM Esports"]);
    expect(within(matchup).getByText("Mine Esports")).toBeInTheDocument();
    expect(within(matchup).getByText("UCAM Esports")).toBeInTheDocument();
  });

  it("says the result as a large word: a loss in red, with the word, and the A of 2 label", () => {
    setup();
    const word = document.querySelector('[data-slot="phone-result-word"]') as HTMLElement;
    expect(word).toHaveTextContent("Loss");
    expect(word).toHaveAttribute("data-result", "lost");
    expect(word.className).toContain("text-negative");
    expect(word.className).toContain("text-title");
    expect(screen.getByText("A of 2")).toBeInTheDocument();
  });

  it("says a win in the positive colour, with its word, and leaves the detected issue out", () => {
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    const word = document.querySelector('[data-slot="phone-result-word"]') as HTMLElement;
    expect(word).toHaveTextContent("Win");
    expect(word).toHaveAttribute("data-result", "won");
    expect(word.className).toContain("text-positive");
    expect(word.className).not.toContain("text-negative");
    expect(screen.queryByText("Detected issue")).toBeNull();
  });

  it("lists the report's focus, the quality and the detected issue after a loss", () => {
    setup();
    const facts = document.querySelector('[data-slot="phone-decision-facts"]') as HTMLElement;
    for (const text of ["Report focus", "Fix early game", "Quality", "61", "Detected issue", "Lane pressure"]) {
      expect(within(facts).getByText(text)).toBeInTheDocument();
    }
  });

  it("never cuts a team's name where the team is the subject: it takes two lines", () => {
    setup({ rival: { name: "Team Heretics Academy", tag: "THA", logoUrl: null } });
    const name = within(document.querySelector('[data-slot="phone-matchup"]') as HTMLElement).getByText("Team Heretics Academy");
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).not.toContain("truncate");
  });
});

describe("ScrimDecisionPane: the glossary", () => {
  it("puts the ? at the right end of the top row, after the closing sentence, as a target", () => {
    setup(closeDay(false));
    const top = document.querySelector('[data-slot="scrim-view-top"]') as HTMLElement;
    const help = within(top).getByRole("button", { name: "What each number means" });
    expect(help.className).toContain("size-[var(--hit)]");
    const controls = [...top.querySelectorAll("button")];
    expect(controls[controls.length - 1]).toBe(help);
  });
});

describe("ScrimDecisionPane: the effects table", () => {
  it("offers Push through and Cancel scrims after a loss, Continue and Offer rest after a win, in the game's order", () => {
    const { unmount } = setup();
    expect(titles()).toEqual(["Push through", "Cancel scrims"]);
    unmount();
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    expect(titles()).toEqual(["Continue to block 2", "Offer rest"]);
  });

  it("closes the day with one row after a win and four after a loss", () => {
    const { unmount } = setup(closeDay(true));
    expect(titles()).toEqual(["Day off"]);
    unmount();
    setup(closeDay(false));
    expect(titles()).toEqual(["Day off", "VOD Review", "Mental Reset", "Targeted Drills"]);
    expect(screen.getByText("B of 2")).toBeInTheDocument();
  });

  it("draws any number of options as rows, from one to four, none of them left out", () => {
    const options = makeOptions({ isFirstBlock: false, won: false, report: makeReport({ slot_index: 1 }) });
    for (const count of [1, 2, 3, 4]) {
      const { unmount } = setup({ options: options.slice(0, count) });
      expect(rows()).toHaveLength(count);
      unmount();
    }
  });

  it("says the stat names once, in a header, in the fixed order Quality, Morale, Energy, hidden from assistive technology", () => {
    setup(closeDay(false));
    const header = document.querySelector('[data-slot="effects-header"]') as HTMLElement;
    expect(header).toHaveAttribute("aria-hidden", "true");
    expect([...header.querySelectorAll("[data-stat]")].map((cell) => cell.getAttribute("data-stat"))).toEqual(["quality", "morale", "energy"]);
    expect([...header.querySelectorAll("[data-stat]")].map((cell) => cell.textContent)).toEqual(["Quality", "Morale", "Energy"]);
    expect(document.querySelectorAll('[data-slot="effects-header"]')).toHaveLength(1);
    // The names are not repeated in the rows, which hold values only.
    for (const row of rows()) expect(row.querySelector('[data-stat="quality"]')?.textContent).not.toContain("Quality");
  });

  it("gives each stat its own fixed column, in order, with a dash where an option leaves it alone", () => {
    setup(closeDay(false));
    expect(cellKinds(rowOf("Day off"))).toEqual(["none", "up", "up"]);
    expect(cellKinds(rowOf("VOD Review"))).toEqual(["up", "up", "down"]);
    expect(cellKinds(rowOf("Mental Reset"))).toEqual(["none", "up", "up"]);
    expect(cellKinds(rowOf("Targeted Drills"))).toEqual(["up", "none", "down"]);
    const dash = rowOf("Day off").querySelector('[data-stat="quality"] [data-slot="stat-value"]') as HTMLElement;
    expect(dash.className).toContain("text-dim");
    expect(dash).toHaveTextContent("\u2014");
  });

  it("draws a rise with the up arrow and +n, a drop with the DOWN arrow, the minus and the amber, and Calidad with where it ends", () => {
    setup(closeDay(false));
    const vod = rowOf("VOD Review");
    const quality = vod.querySelector('[data-stat="quality"] [data-slot="stat-value"]') as HTMLElement;
    expect(quality).toHaveTextContent("+6");
    expect(quality).toHaveTextContent("\u2192 67");
    expect(quality.className).toContain("text-positive");
    expect(quality.querySelector(".lucide-arrow-up")).not.toBeNull();
    const energy = vod.querySelector('[data-stat="energy"] [data-slot="stat-value"]') as HTMLElement;
    expect(energy).toHaveTextContent("\u22121");
    expect(energy.className).toContain("text-warning");
    expect(energy.querySelector(".lucide-arrow-down")).not.toBeNull();
    expect(energy.querySelector(".lucide-arrow-up")).toBeNull();
  });

  it("never shows Severity, nor the label Picked players, on any option", () => {
    setup(closeDay(false));
    const text = pane().textContent ?? "";
    expect(text).not.toMatch(/Severity/i);
    expect(text).not.toContain("Picked players");
    for (const row of rows()) expect(row.querySelector("button")?.getAttribute("aria-label")).not.toMatch(/Severity/i);
  });

  it("names each row for assistive technology: the option, then each stat in words in the same order, then the cost", () => {
    setup();
    expect(screen.getByRole("button", { name: "Push through. Quality goes up 12, ends at 73. Morale: no change. Energy goes down 6." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel scrims. Quality: no change. Morale: no change. Energy: no change. Cost: Scrim rep 30 \u2192 25." })).toBeInTheDocument();
  });

  it("gives each description to a screen reader through aria-describedby, and keeps the description whole under the name, in Spanish too", async () => {
    await i18n.changeLanguage("es");
    setup(closeDay(false));
    for (const row of rows()) {
      const button = row.querySelector("button") as HTMLElement;
      const description = document.getElementById(button.getAttribute("aria-describedby") ?? "") as HTMLElement;
      expect(description.className).not.toContain("line-clamp");
      expect(description.className).toContain("col-span-full");
    }
    for (const text of [
      "Da el resto del día libre y recupera.",
      "Revisa el VOD para sacar aprendizajes concretos de los errores.",
      "Prioriza la moral y reinicia el tilt antes de las próximas sesiones.",
      "Haz ejercicios centrados en el problema detectado.",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("with two options carries the extra line: the neutral sentence, or the amber cost box with where Rep scrims ends", () => {
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    expect(within(rowOf("Continue to block 2")).getByText("Block B plays now. Its report waits for your decision.")).toBeInTheDocument();
    const box = rowOf("Offer rest").querySelector('[data-slot="effects-cost"]') as HTMLElement;
    expect(box).toHaveTextContent("Cost");
    expect(box).toHaveTextContent("Scrim rep 30 \u2192 25");
    expect(box).toHaveTextContent("Cancels block B.");
    expect(box.className).toContain("border-warning");
    expect(rowOf("Offer rest")).not.toHaveTextContent("The day closes");
  });

  it("with three or more options and a cost, the cost takes the description's place as one amber line", () => {
    const cancel = makeOptions({ isFirstBlock: true, won: false }).find((option) => option.id === "CancelScrims")!;
    const rest = makeOptions({ isFirstBlock: false, won: false, report: makeReport({ slot_index: 1 }) }).slice(0, 2);
    setup({ options: [...rest, cancel] });
    const line = rowOf("Cancel scrims").querySelector('[data-slot="effects-cost-line"]') as HTMLElement;
    expect(line.className).toContain("text-warning");
    expect(line).toHaveTextContent("Cost");
    expect(rowOf("Cancel scrims")).not.toHaveTextContent("Applies nothing yet and moves on");
  });

  it("says once, in the top row, that the day closes when several options close it", () => {
    setup(closeDay(false));
    const closing = document.querySelector('[data-slot="decision-closing"]') as HTMLElement;
    expect(document.querySelector('[data-slot="scrim-view-top"]')).toContainElement(closing);
    expect(screen.getAllByText("The day closes after this decision.")).toHaveLength(1);
  });

  it("keeps the single option of a won day with its sentence in the row", () => {
    setup(closeDay(true));
    expect(rows()[0]).toHaveTextContent("The day closes after this decision.");
  });

  it("holds the heights of one to four rows: rows are at least a target high with a 4 px gap, the header is 22 px", () => {
    setup(closeDay(false));
    // 22 + 4 x 48 + 3 x 4 = 226 of the 226 px under the top row.
    expect((document.querySelector('[data-slot="effects-header"]') as HTMLElement).className).toContain("h-[1.375rem]");
    for (const row of rows()) expect(row.className).toContain("min-h-[var(--hit)]");
    expect(document.querySelector('[data-slot="effects-table"]')!.className).toContain("gap-1");
  });

  it("draws a very faint band behind each of the three stat columns from the header down", () => {
    setup();
    const bands = document.querySelector('[data-slot="effects-bands"]') as HTMLElement;
    expect(bands).toHaveAttribute("aria-hidden", "true");
    expect(bands.className).toContain("inset-0");
    expect([...bands.children].filter((child) => child.className.includes("bg-foreground/"))).toHaveLength(3);
  });
});

describe("ScrimDecisionPane: pressing", () => {
  it("decides with one press and no confirmation, the whole row being the button", () => {
    const { onDecide } = setup();
    const row = rowOf("Push through");
    expect(row.querySelectorAll("button")).toHaveLength(1);
    fireEvent.click(row.querySelector("button") as HTMLElement);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("PushThrough");
  });

  it("has a pressed and a focus-visible state", () => {
    setup();
    const button = rowOf("Push through").querySelector("button") as HTMLElement;
    expect(button.className).toContain("active:bg-muted");
    expect(button.className).toContain("focus-visible:ring-2");
  });

  it("says Saving on the row that saves and makes every row aria-disabled but focusable and unpressable", () => {
    const { onDecide } = setup({ savingId: "PushThrough" });
    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
    const buttons = rows().map((row) => row.querySelector("button") as HTMLElement);
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
    }
    fireEvent.click(buttons[1]);
    expect(onDecide).not.toHaveBeenCalled();
    buttons[1].focus();
    expect(buttons[1]).toHaveFocus();
  });

  it("does not show a saving row by lower opacity", () => {
    setup({ savingId: "PushThrough" });
    for (const row of rows()) expect(row.querySelector("button")!.className).not.toMatch(/opacity/);
  });
});
