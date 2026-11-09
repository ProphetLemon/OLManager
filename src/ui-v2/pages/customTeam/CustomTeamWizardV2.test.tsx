import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildBadgeDataUri } from "@/lib/customTeam";
import type { CompetitionSummary } from "@/store/types";
import { TAKEN_NICK, previewInvoke } from "./founders/foundersTestKit";
import type { PreviewCall } from "./founders/foundersTestKit";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

let previewCalls: PreviewCall[] = [];
beforeEach(() => {
  previewCalls = [];
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(previewInvoke(previewCalls));
});

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return {
    initReactI18next: { type: "3rdParty", init: vi.fn() },
    useTranslation: () => ({ i18n: { language: "en" }, t: translateFromEnglish }),
  };
});

import CustomTeamWizardV2, { suggestShortName } from "./CustomTeamWizardV2";

function team(id: string, name: string, short: string, reputation: number | null) {
  return {
    id,
    name,
    short_name: short,
    logo_url: null,
    country: "Atlantis",
    reputation,
    colors: null,
    ovr: null,
    player_count: 5,
  };
}

const competition: CompetitionSummary = {
  id: "les",
  name: "LES",
  region: "Spain",
  logo: null,
  tier: 2,
  legacy: false,
  active: true,
  team_count: 3,
  custom_team_allowed: true,
  teams: [
    team("les-a", "Falke Esports", "FAL", 300),
    team("les-b", "Other Club", "OTH", 180),
    team("les-c", "Unknown Club", "UNK", null),
  ],
};

function setup(props: Partial<React.ComponentProps<typeof CustomTeamWizardV2>> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <CustomTeamWizardV2
      competition={competition}
      onCancel={onCancel}
      onConfirm={onConfirm}
      isSubmitting={false}
      error={null}
      {...props}
    />,
  );
  return { onCancel, onConfirm, ...view };
}

const next = () => screen.getByRole("button", { name: "Next" });

function fillIdentity(name = "Ray Esports", country = "ES") {
  fireEvent.change(screen.getByLabelText("Club name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: country } });
}

/** Walks to the mode and review step, with joining still selected. */
function toModeStep() {
  fillIdentity();
  fireEvent.click(next());
  fireEvent.click(next());
}

const chooseReplace = () => fireEvent.click(screen.getByRole("radio", { name: "Replace a club" }));

/** Walks to the mode step and chooses to replace a club. */
function toReviewStep() {
  toModeStep();
  chooseReplace();
}

/** Walks to the founding squad step and waits for the preview. */
async function toSquadStep() {
  toReviewStep();
  fireEvent.click(next());
  await screen.findByTestId("founder-mid");
}

const lastSeed = () => previewCalls[previewCalls.length - 1].seed;

describe("suggestShortName", () => {
  it("uses initials for three or more words and the first letters otherwise", () => {
    expect(suggestShortName("Ray Esports")).toBe("RAY");
    expect(suggestShortName("Falké Esports")).toBe("FAL");
    expect(suggestShortName("Real Madrid Gaming Club")).toBe("RMGC");
    expect(suggestShortName("   ")).toBe("");
  });
});

describe("CustomTeamWizardV2 identity step", () => {
  it("keeps Next disabled until name, short name and country are valid", () => {
    setup();
    expect(next()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "Ray Esports" } });
    // Short name was auto-suggested from the name; the country is still empty.
    expect(screen.getByLabelText("Short name")).toHaveValue("RAY");
    expect(next()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "ES" } });
    expect(next()).toBeEnabled();
  });

  it("uppercases a typed short name and stops auto-suggesting after an edit", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Short name"), { target: { value: "ab1" } });
    fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "Zeta Club" } });
    expect(screen.getByLabelText("Short name")).toHaveValue("AB1");
  });

  it("rejects a 5 character short name with an announced error", () => {
    setup();
    fillIdentity();
    const short = screen.getByLabelText("Short name");
    fireEvent.change(short, { target: { value: "ABCDE" } });
    fireEvent.blur(short);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Use at most 4 characters.");
    expect(short).toHaveAttribute("aria-invalid", "true");
    expect(short.getAttribute("aria-describedby")).toContain(alert.id);
    expect(next()).toBeDisabled();
  });

  it("blocks a name that another club of the league already uses", () => {
    setup();
    fillIdentity("falke esports");
    fireEvent.blur(screen.getByLabelText("Club name"));
    expect(screen.getByRole("alert")).toHaveTextContent("Another club already uses this name.");
    expect(next()).toBeDisabled();
  });

  it("goes back to the team grid on Escape from the first step", () => {
    const { onCancel } = setup();
    fireEvent.keyDown(screen.getByLabelText("Club name"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("CustomTeamWizardV2 badge step", () => {
  it("updates both previews when the colours change", () => {
    setup();
    fillIdentity();
    fireEvent.click(next());

    fireEvent.change(screen.getByLabelText("Primary colour"), { target: { value: "#112233" } });
    fireEvent.change(screen.getByLabelText("Secondary colour"), { target: { value: "#ffeedd" } });

    const expected = buildBadgeDataUri("RAY", "#112233", "#ffeedd");
    expect(screen.getByTestId("badge-preview-large")).toHaveAttribute("src", expected);
    expect(screen.getByTestId("badge-preview-small")).toHaveAttribute("src", expected);
  });

  it("applies a preset and exposes colour pickers with text alternatives", () => {
    setup();
    fillIdentity();
    fireEvent.click(next());

    expect(screen.getByLabelText("Pick the primary colour")).toHaveAttribute("type", "color");
    expect(screen.getByLabelText("Pick the secondary colour")).toHaveAttribute("type", "color");

    fireEvent.click(screen.getByRole("button", { name: "Colours #1d4ed8 and #ffffff" }));
    expect(screen.getByLabelText("Primary colour")).toHaveValue("#1d4ed8");
    expect(screen.getByTestId("badge-preview-large")).toHaveAttribute(
      "src",
      buildBadgeDataUri("RAY", "#1d4ed8", "#ffffff"),
    );
  });

  it("warns softly about low contrast without blocking Next", () => {
    setup();
    fillIdentity();
    fireEvent.click(next());
    fireEvent.change(screen.getByLabelText("Primary colour"), { target: { value: "#222222" } });
    fireEvent.change(screen.getByLabelText("Secondary colour"), { target: { value: "#242424" } });

    expect(screen.getByRole("status")).toHaveTextContent(/hard to read/);
    expect(next()).toBeEnabled();
  });

  it("goes back one step on Escape and moves focus to the step heading", () => {
    setup();
    fillIdentity();
    fireEvent.click(next());
    expect(screen.getByRole("heading", { name: "Badge" })).toHaveFocus();

    fireEvent.keyDown(screen.getByLabelText("Primary colour"), { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Identity" })).toHaveFocus();
    expect(screen.getByLabelText("Club name")).toHaveValue("Ray Esports");
  });
});

describe("CustomTeamWizardV2 replace and review step", () => {
  it("preselects the lowest-reputation club and never a club without reputation", () => {
    setup();
    toReviewStep();
    expect(screen.getByRole("radio", { name: /Other Club/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Unknown Club/ })).not.toBeChecked();
    expect(screen.getByText(/become free agents/)).toBeInTheDocument();
  });

  it("shows the reputation tier in English, with no Spanish tier text", () => {
    setup();
    toReviewStep();
    expect(screen.getByRole("radio", { name: /Other Club/ }).closest("label")).toHaveTextContent("Developing");
    expect(document.body.textContent).not.toMatch(/En desarrollo|Media|Fuerte|Élite/);
  });

  it("confirms with the trimmed spec, the chosen replacement and the previewed seed", async () => {
    const { onConfirm } = setup();
    fillIdentity("  Ray Esports  ");
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Colours #b91c1c and #fafafa" }));
    fireEvent.click(next());
    chooseReplace();
    fireEvent.click(screen.getByRole("radio", { name: /Falke Esports/ }));
    fireEvent.click(next());
    await screen.findByTestId("founder-mid");
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    // The spec carries the seed of the last preview and no overrides when none were made,
    // so the install reproduces exactly the squad that was shown.
    expect(onConfirm).toHaveBeenCalledWith(
      {
        name: "Ray Esports",
        short_name: "RAY",
        primary_color: "#b91c1c",
        secondary_color: "#fafafa",
        country: "ES",
        founding_seed: lastSeed(),
      },
      "les-a",
    );
    expect(previewCalls[previewCalls.length - 1]).toMatchObject({
      competitionId: "les",
      replacedTeamId: "les-a",
      shortName: "RAY",
    });
  });

  it("disables Create club while submitting", async () => {
    const { onConfirm } = setup({ isSubmitting: true });
    await toSquadStep();
    const confirm = screen.getByRole("button", { name: "Create club" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("CustomTeamWizardV2 backend errors", () => {
  it("shows a localized duplicate-name message on the name field and returns to that step", () => {
    const { rerender } = setup();
    toReviewStep();

    rerender(
      <CustomTeamWizardV2
        competition={competition}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        isSubmitting={false}
        error="Another team already uses this name"
      />,
    );

    expect(screen.getByRole("heading", { name: "Identity" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Another club already uses this name.");
    expect(screen.getByLabelText("Club name")).toHaveAttribute("aria-invalid", "true");

    // Editing the field clears the backend message.
    fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "Ray Gaming" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("maps a duplicate short name to the short-name field", () => {
    setup({ error: "Another team already uses this short name" });
    expect(screen.getByRole("alert")).toHaveTextContent("Another club already uses this short name.");
    expect(screen.getByLabelText("Short name")).toHaveAttribute("aria-invalid", "true");
  });

  it("renders an unmapped backend error verbatim on the squad step", async () => {
    setup({ error: "disk exploded" });
    await toSquadStep();
    const alert = within(screen.getByText("disk exploded").closest("[role=alert]") as HTMLElement);
    expect(alert.getByText("disk exploded")).toBeInTheDocument();
  });

  it("shows a founder rejection at the squad step instead of the raw JSON", async () => {
    const raw = JSON.stringify({ kind: "invalid_field", role: "MID", field: "nick", reason: "taken" });
    const { rerender } = setup();
    await toSquadStep();
    rerender(
      <CustomTeamWizardV2
        competition={competition}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        isSubmitting={false}
        error={raw}
      />,
    );
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Squad rejected. Mid, Nick: Another player already uses this name.");
  });

  it("goes to the squad step when a founder rejection arrives from another step", () => {
    const raw = JSON.stringify({ kind: "invalid_field", role: "TOP", field: "full_name", reason: "too_short" });
    setup({ error: raw });
    expect(screen.getByRole("heading", { name: "Founding squad" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 2 characters.");
  });
});

describe("CustomTeamWizardV2 founding squad step", () => {
  it("previews the squad once the replaced club is known and shows its founders", async () => {
    setup();
    toReviewStep();
    expect(previewCalls).toHaveLength(0);
    fireEvent.click(next());
    const mid = await screen.findByTestId("founder-mid");

    // One generated squad, no overrides: the plain preview is the whole request.
    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0].founderOverrides).toBeNull();
    expect(within(mid).getByText("Mid")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Founding squad" }).children).toHaveLength(5);
    expect(within(mid).getByText("Age 20")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Wage bill against budget" })).toBeInTheDocument();
  });

  it("keeps Create club disabled until the preview matches the current inputs", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = previewInvoke(previewCalls);
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      await gate;
      return fake(command, args);
    });
    setup();
    toReviewStep();
    fireEvent.click(next());
    expect(screen.getByRole("button", { name: "Create club" })).toBeDisabled();
    expect(screen.getByText("Generating your squad...")).toBeInTheDocument();
    release();
    await screen.findByTestId("founder-mid");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled());
  });

  it("offers a retry when the preview fails", async () => {
    mocks.invoke.mockRejectedValueOnce("backend down");
    setup();
    toReviewStep();
    fireEvent.click(next());
    expect(await screen.findByText("The squad could not be generated.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create club" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("founder-mid");
    expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled();
  });

  it("rerolls up to three times with a new seed each time, then explains why it stops", async () => {
    setup();
    await toSquadStep();
    const seeds = [lastSeed()];

    for (const left of [2, 1, 0]) {
      fireEvent.click(screen.getByRole("button", { name: /^Reroll squad/ }));
      await waitFor(() => expect(lastSeed()).not.toBe(seeds[seeds.length - 1]));
      seeds.push(lastSeed());
      await screen.findByTestId("founder-mid");
      if (left > 0) {
        expect(screen.getByRole("button", { name: `Reroll squad (${left} left)` })).toBeEnabled();
      }
    }

    const exhausted = screen.getByRole("button", { name: "No rerolls left" });
    // Unavailable but still focusable, so focus is not lost when the last reroll is used.
    expect(exhausted).toHaveAttribute("aria-disabled", "true");
    expect(exhausted).toHaveAccessibleDescription("You have used all 3 rerolls for this club.");
    expect(new Set(seeds).size).toBe(4);
  });

  it("sends the edited identity with the previewed seed", async () => {
    const { onConfirm } = setup();
    await toSquadStep();
    fireEvent.click(screen.getByRole("button", { name: /^Edit .*Mid$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nick"), { target: { value: "Ray" } });
    fireEvent.change(within(dialog).getByLabelText("Nationality"), { target: { value: "FR" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const mid = screen.getByTestId("founder-mid");
    expect(within(mid).getByText("Ray")).toBeInTheDocument();
    expect(within(mid).getByText("Edited")).toBeInTheDocument();
    // Only the changed fields travel; the generated ones stay out of the override.
    expect(previewCalls[previewCalls.length - 1]?.founderOverrides).toEqual({ mid: { nick: "Ray", nationality: "FR" } });

    fireEvent.click(screen.getByRole("button", { name: "Create club" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        founding_seed: lastSeed(),
        founder_overrides: { mid: { nick: "Ray", nationality: "FR" } },
      }),
      "les-b",
    );
  });

  it("shows the backend's field error under the field and keeps the squad unedited", async () => {
    setup();
    await toSquadStep();
    fireEvent.click(screen.getByRole("button", { name: /^Edit .*Mid$/ }));
    const dialog = await screen.findByRole("dialog");
    const nick = within(dialog).getByLabelText("Nick");
    fireEvent.change(nick, { target: { value: TAKEN_NICK } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Another player already uses this name.");
    expect(nick).toHaveAttribute("aria-invalid", "true");
    expect(nick.getAttribute("aria-describedby")).toContain(alert.id);
    expect(screen.getByTestId("founder-mid")).not.toHaveTextContent("Edited");
  });

  it("closes the edit dialog on Escape without leaving the squad step", async () => {
    setup();
    await toSquadStep();
    fireEvent.click(screen.getByRole("button", { name: /^Edit .*Mid$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(within(dialog).getByLabelText("Nick"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Founding squad" })).toBeInTheDocument();
  });

  it("asks before a reroll discards edits, and clears them once confirmed", async () => {
    const { onConfirm } = setup();
    await toSquadStep();
    fireEvent.click(screen.getByRole("button", { name: /^Edit .*Top$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Ana Pons" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const editedSeed = lastSeed();

    fireEvent.click(screen.getByRole("button", { name: /^Reroll squad/ }));
    expect(screen.getByText("Rerolling draws a new squad and discards your edits.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep this squad" }));
    expect(lastSeed()).toBe(editedSeed);
    expect(screen.getByRole("button", { name: "Reroll squad (3 left)" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^Reroll squad/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reroll anyway" }));
    await waitFor(() => expect(lastSeed()).not.toBe(editedSeed));
    await screen.findByRole("button", { name: "Reroll squad (2 left)" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    const spec = onConfirm.mock.calls[0][0];
    expect(spec.founding_seed).toBe(lastSeed());
    expect(spec).not.toHaveProperty("founder_overrides");
  });

  it("previews again when the short name changes after going back", async () => {
    setup();
    await toSquadStep();
    const before = previewCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByLabelText("Short name"), { target: { value: "RYO" } });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(next());
    await screen.findByTestId("founder-mid");

    expect(previewCalls.length).toBeGreaterThan(before);
    expect(previewCalls[previewCalls.length - 1]?.shortName).toBe("RYO");
  });
});

describe("CustomTeamWizardV2 founding squad step: focus and announcements", () => {
  const reroll = () => screen.getByRole("button", { name: /^Reroll squad/ });

  async function editTopFullName() {
    fireEvent.click(screen.getByRole("button", { name: /^Edit .*Top$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Ana Pons" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }

  it("keeps focus on Reroll and announces the new squad with the rerolls left", async () => {
    setup();
    await toSquadStep();

    fireEvent.click(reroll());

    expect(reroll()).toHaveFocus();
    expect(await screen.findByText("New squad ready. 2 rerolls left.")).toBeInTheDocument();
    expect(reroll()).toHaveFocus();
  });

  it("does not announce a new squad before the reroll has been answered", async () => {
    setup();
    await toSquadStep();

    fireEvent.click(reroll());

    expect(screen.queryByText(/New squad ready/)).not.toBeInTheDocument();
    await screen.findByText("New squad ready. 2 rerolls left.");
  });

  it("moves focus to the confirmation, and back to Reroll when it is answered", async () => {
    setup();
    await toSquadStep();
    await editTopFullName();

    fireEvent.click(reroll());
    expect(screen.getByRole("group", { name: "Confirm reroll" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Keep this squad" }));
    expect(reroll()).toHaveFocus();

    fireEvent.click(reroll());
    fireEvent.click(screen.getByRole("button", { name: "Reroll anyway" }));
    expect(reroll()).toHaveFocus();
    await screen.findByText("New squad ready. 2 rerolls left.");
  });

  it("keeps focus on the page when the last reroll is used", async () => {
    setup();
    await toSquadStep();
    for (const left of [2, 1, 0]) {
      fireEvent.click(reroll());
      await screen.findByText(new RegExp(`New squad ready. ${left} reroll`));
    }

    expect(screen.getByRole("button", { name: "No rerolls left" })).toHaveFocus();
  });

  it("returns focus to Reroll when Try again is pressed", async () => {
    mocks.invoke.mockRejectedValueOnce("backend down");
    setup();
    toReviewStep();
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(reroll()).toHaveFocus();
    await screen.findByTestId("founder-mid");
  });

  it("disables Edit while the shown squad is stale after a failed refetch", async () => {
    setup();
    await toSquadStep();
    const fake = previewInvoke(previewCalls);
    mocks.invoke.mockImplementation(async () => {
      throw "backend down";
    });

    fireEvent.click(reroll());
    await screen.findByText("The squad could not be generated.");

    // The old squad is still listed, but it can no longer be edited against a stale baseline.
    const edits = screen.getAllByRole("button", { name: /^Edit / });
    expect(edits).toHaveLength(5);
    for (const edit of edits) expect(edit).toBeDisabled();

    mocks.invoke.mockImplementation(fake);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Edit / })[0]).toBeEnabled());
  });
});

describe("CustomTeamWizardV2 join or replace choice", () => {
  const joinRadio = () => screen.getByRole("radio", { name: "Join the league" });
  const replaceRadio = () => screen.getByRole("radio", { name: "Replace a club" });

  /** From the mode step, with joining selected, to the squad step and its first preview. */
  async function toJoinSquadStep() {
    toModeStep();
    fireEvent.click(next());
    await screen.findByTestId("founder-mid");
  }

  it("preselects joining and offers both modes in a labelled group, joining first", () => {
    setup();
    toModeStep();

    const group = screen.getByRole("group", { name: "How your club enters the league" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.slice(0, 2).map((radio) => radio.getAttribute("aria-labelledby"))).toEqual([
      "custom-team-mode-join-label",
      "custom-team-mode-replace-label",
    ]);
    expect(joinRadio()).toBeChecked();
    expect(replaceRadio()).not.toBeChecked();
    expect(next()).toBeEnabled();
  });

  it("ties each option to its description and counts the real league size", () => {
    setup();
    toModeStep();
    expect(joinRadio()).toHaveAccessibleDescription("Nobody is replaced. The league will have 4 clubs.");
    expect(replaceRadio()).toHaveAccessibleDescription(
      "The club you choose leaves the league, and its players and staff are released as free agents.",
    );
  });

  it("says one club rests each matchday when the league ends up with an odd number of clubs", () => {
    const four = {
      ...competition,
      teams: [...competition.teams, team("les-d", "Fourth Club", "FOU", 250)],
    };
    setup({ competition: four });
    toModeStep();
    expect(joinRadio()).toHaveAccessibleDescription(
      "Nobody is replaced. The league will have 5 clubs, so one club rests each matchday and the split has more matchdays.",
    );
  });

  it("hides the club picker while joining and shows it, preselected, when replacing", () => {
    setup();
    toModeStep();
    expect(screen.queryByRole("radio", { name: /Falke Esports/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Club to replace")).not.toBeInTheDocument();

    fireEvent.click(replaceRadio());
    expect(screen.getByText("Club to replace")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Other Club/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Falke Esports/ }));
    fireEvent.click(joinRadio());
    expect(screen.queryByText("Club to replace")).not.toBeInTheDocument();
    fireEvent.click(replaceRadio());
    // The choice made before switching is still there.
    expect(screen.getByRole("radio", { name: /Falke Esports/ })).toBeChecked();
  });

  it("puts both modes in one native radio group, so the arrow keys move between them", () => {
    setup();
    toModeStep();
    expect(joinRadio()).toHaveAttribute("name", "custom-team-mode");
    expect(replaceRadio()).toHaveAttribute("name", "custom-team-mode");
    // The club picker is a different group, so its arrows never leave the picker.
    fireEvent.click(replaceRadio());
    expect(screen.getByRole("radio", { name: /Falke Esports/ })).toHaveAttribute("name", "custom-team-replace");
  });

  it("states the mode in the summary", () => {
    setup();
    toModeStep();
    const summary = () => screen.getByRole("region", { name: "Summary" });
    expect(summary()).toHaveTextContent("Ray Esports (RAY) from Spain joins LES as club number 4.");

    fireEvent.click(replaceRadio());
    expect(summary()).toHaveTextContent("Ray Esports (RAY) from Spain will replace Other Club.");
  });

  it("confirms a join with no replaced club and the previewed seed", async () => {
    const { onConfirm } = setup();
    await toJoinSquadStep();
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ray Esports", short_name: "RAY", founding_seed: lastSeed() }),
      null,
    );
  });

  it("previews without a replaced club when joining, and with it when replacing", async () => {
    setup();
    await toJoinSquadStep();
    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0]).toMatchObject({ competitionId: "les", shortName: "RAY" });
    expect(Object.keys(previewCalls[0])).not.toContain("replacedTeamId");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(replaceRadio());
    fireEvent.click(next());
    await waitFor(() => expect(previewCalls.length).toBeGreaterThan(1));
    expect(previewCalls[previewCalls.length - 1]).toMatchObject({ replacedTeamId: "les-b" });
  });

  it("previews again after a mode switch and keeps Create club closed until it lands", async () => {
    setup();
    await toJoinSquadStep();
    const seed = lastSeed();
    expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled();

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = previewInvoke(previewCalls);
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      await gate;
      return fake(command, args);
    });
    const before = previewCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(replaceRadio());
    fireEvent.click(next());

    expect(screen.getByRole("button", { name: "Create club" })).toBeDisabled();
    expect(screen.getByText("Generating your squad...")).toBeInTheDocument();
    release();
    await screen.findByTestId("founder-mid");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled());

    expect(previewCalls.length).toBeGreaterThan(before);
    // Same rule as changing the replaced club: the seed, the rerolls used and the edits carry over.
    expect(lastSeed()).toBe(seed);
  });

  it("keeps the rerolls used when the mode changes", async () => {
    setup();
    await toJoinSquadStep();
    fireEvent.click(screen.getByRole("button", { name: /^Reroll squad/ }));
    await screen.findByText("New squad ready. 2 rerolls left.");
    const seed = lastSeed();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(replaceRadio());
    fireEvent.click(next());
    await screen.findByRole("button", { name: "Reroll squad (2 left)" });
    expect(lastSeed()).toBe(seed);
  });

  it("sends the replaced club, not null, once the player switches back to replacing", async () => {
    const { onConfirm } = setup();
    await toJoinSquadStep();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(replaceRadio());
    fireEvent.click(next());
    await waitFor(() => expect(previewCalls[previewCalls.length - 1].replacedTeamId).toBe("les-b"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ founding_seed: lastSeed() }), "les-b");
  });

  it.each([
    ["Competition 'lec' does not accept custom clubs", "This league does not accept new clubs. Go back and choose another league or an existing team."],
    ["Competition 'les' has no clubs to join", "This league has no clubs to join. Go back and choose another league."],
    ["Joining a league needs a custom club", "The request to join the league was not valid. Go back a step and try again."],
  ])("shows %j as a readable message on the mode step", (raw, readable) => {
    setup({ error: raw });
    expect(screen.getByRole("heading", { name: "Join or replace" })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(readable);
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
    expect(document.querySelector("pre")).toBeNull();
  });

  it("brings the player back to the mode step from the squad step and clears the message on a new choice", async () => {
    const { rerender } = setup();
    await toJoinSquadStep();
    rerender(
      <CustomTeamWizardV2
        competition={competition}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        isSubmitting={false}
        error="Competition 'les' does not accept custom clubs"
      />,
    );
    expect(screen.getByRole("heading", { name: "Join or replace" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("This league does not accept new clubs.");

    fireEvent.click(replaceRadio());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
