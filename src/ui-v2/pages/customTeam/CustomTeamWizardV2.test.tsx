import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildBadgeDataUri } from "@/lib/customTeam";
import type { CompetitionSummary } from "@/store/types";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (_key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === "string") return options;
      const template = String(options?.defaultValue ?? _key);
      return template.replace(/{{(\w+)}}/g, (_m, name) => String(options?.[name] ?? ""));
    },
  }),
}));

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

function toReviewStep() {
  fillIdentity();
  fireEvent.click(next());
  fireEvent.click(next());
}

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

  it("confirms with the trimmed spec and the chosen replacement", () => {
    const { onConfirm } = setup();
    fillIdentity("  Ray Esports  ");
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Colours #b91c1c and #fafafa" }));
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("radio", { name: /Falke Esports/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    expect(onConfirm).toHaveBeenCalledWith(
      {
        name: "Ray Esports",
        short_name: "RAY",
        primary_color: "#b91c1c",
        secondary_color: "#fafafa",
        country: "ES",
      },
      "les-a",
    );
  });

  it("disables Create club while submitting", () => {
    const { onConfirm } = setup({ isSubmitting: true });
    toReviewStep();
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

  it("renders an unmapped backend error verbatim on the review step", () => {
    setup({ error: "disk exploded" });
    toReviewStep();
    const alert = within(screen.getByRole("alert"));
    expect(alert.getByText("disk exploded")).toBeInTheDocument();
  });
});
